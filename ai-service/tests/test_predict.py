import itertools

import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from app.model.conditions import load_conditions

SETTINGS = Settings()
CONDITIONS = load_conditions(SETTINGS.shared_dir)


@pytest.fixture(scope="module")
def app():
    return create_app(SETTINGS)


@pytest.fixture(scope="module")
def client(app) -> TestClient:
    return TestClient(app)


def predict(client: TestClient, **body) -> dict:
    res = client.post("/predict", json={"ageMonths": 420, **body})
    assert res.status_code == 200, res.text
    return res.json()


def test_common_cold(client: TestClient) -> None:
    body = predict(client, symptoms=["runny_nose", "congestion", "sinus_pressure", "loss_of_smell", "cough"])
    assert body["source"] == "model"
    assert body["topConditions"][0]["id"] == "common_cold"
    assert len(body["topConditions"]) == 3
    top = body["topConditions"][0]
    assert top["name"] == {"en": "Common cold", "ta": "ஜலதோஷம்", "hi": "सामान्य सर्दी-ज़ुकाम"}
    assert set(top["advice"]) == {"en", "ta", "hi"}
    assert body["confidence"] == top["probability"]
    assert body["level"] in ("SELF_CARE", "SEE_DOCTOR_SOON")
    assert body["disclaimer"]["en"].startswith("This is triage guidance")
    assert body["modelVersion"].startswith("lr-")


def test_probabilities_are_sorted_and_bounded(client: TestClient) -> None:
    body = predict(client, symptoms=["high_fever", "joint_pain", "pain_behind_the_eyes", "skin_rash"])
    probs = [c["probability"] for c in body["topConditions"]]
    assert probs == sorted(probs, reverse=True)
    assert all(0 <= p <= 1 for p in probs)
    assert body["topConditions"][0]["id"] == "dengue"
    assert body["level"] == "SEE_DOCTOR_24H"


def test_red_flags_bypass_the_model(client: TestClient) -> None:
    body = predict(client, symptoms=["chest_pain", "sweating"])
    assert body["level"] == "EMERGENCY"
    assert body["source"] == "rule_engine"
    assert body["redFlags"] == ["RF_CHEST_PAIN"]
    assert body["topConditions"] == []
    assert body["confidence"] is None
    assert "108" in body["advice"]["en"]


def test_low_confidence_never_self_care(app, client: TestClient) -> None:
    """Symptom pairs whose top condition is SELF_CARE but below the threshold must not get SELF_CARE."""
    predictor = app.state.predictor
    found = 0
    # Red-flag symptoms are excluded: they make the rules answer EMERGENCY before the model runs.
    safe = [f for f in predictor.metadata.features if f not in app.state.red_flags.red_flag_symptoms]
    for pair in itertools.combinations(safe[:60], 2):
        ranking = predictor.rank(pair)
        top = ranking.ranked[0]
        is_self_care = CONDITIONS.get(top.id).triageLevel == "SELF_CARE"
        if is_self_care and top.probability < CONDITIONS.policy.minConfidence:
            body = predict(client, symptoms=list(pair))
            assert body["lowConfidence"] is True
            assert body["level"] != "SELF_CARE"
            found += 1
            if found == 5:
                break
    assert found > 0, "no low-confidence SELF_CARE case found to test"


def test_symptoms_the_model_cannot_see_block_self_care(client: TestClient) -> None:
    acne = ["skin_rash", "pus_filled_pimples", "blackheads", "scurring"]
    body = predict(client, symptoms=[*acne, "vaginal_bleeding"])
    assert body["topConditions"][0]["id"] == "acne"
    assert body["unmodelledSymptoms"] == ["vaginal_bleeding"]
    assert body["level"] == "SEE_DOCTOR_SOON"


def test_no_known_symptoms(client: TestClient) -> None:
    body = predict(client, symptoms=["vaginal_bleeding"])
    assert body["level"] == "SEE_DOCTOR_SOON"
    assert body["lowConfidence"] is True
    assert body["topConditions"] == []


def test_safety_floor_fever_with_unknown_age(client: TestClient) -> None:
    res = client.post("/predict", json={"symptoms": ["mild_fever", "continuous_sneezing", "runny_nose"]})
    body = res.json()
    assert body["safetyFloors"] == ["FLOOR_FEVER_AGE_UNKNOWN"]
    assert body["level"] in ("SEE_DOCTOR_24H",)


def test_validation(client: TestClient) -> None:
    assert client.post("/predict", json={"symptoms": [], "ageMonths": -1}).status_code == 422
    assert client.post("/predict", json={"symptoms": "cough"}).status_code == 422


def test_model_version(app, client: TestClient) -> None:
    body = client.get("/model/version").json()
    meta = app.state.predictor.metadata
    assert body == {
        "modelVersion": meta.modelVersion,
        "algorithm": meta.algorithm,
        "createdAt": meta.createdAt,
        "sha256": meta.sha256,
        "sizeBytes": meta.sizeBytes,
        "featureCount": 131,
        "classCount": 41,
    }


def test_missing_model_gives_503_but_service_starts(tmp_path) -> None:
    client = TestClient(create_app(Settings(model_dir=tmp_path)))
    assert client.get("/health").json()["model"]["loaded"] is False
    assert client.post("/predict", json={"symptoms": ["cough"], "ageMonths": 400}).status_code == 503
    assert client.get("/model/version").status_code == 503
