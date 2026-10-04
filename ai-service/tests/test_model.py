"""The committed ONNX model: integrity, metadata, sklearn parity and the PWA copy."""

import hashlib
import json

import numpy as np
import pytest

from app.config import AI_SERVICE_DIR, REPO_ROOT
from app.model.conditions import load_conditions
from app.model.predictor import METADATA_FILE, MODEL_FILE, Predictor

MODELS = AI_SERVICE_DIR / "models"
CLIENT_MODELS = REPO_ROOT / "client" / "public" / "models"
SHARED = REPO_ROOT / "shared"
FIXTURES = json.loads((MODELS / "parity_fixtures.json").read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def predictor() -> Predictor:
    return Predictor(MODELS)


def test_model_is_small_enough_for_slow_connections() -> None:
    assert (MODELS / MODEL_FILE).stat().st_size < 2 * 1024 * 1024


def test_metadata_matches_model_file(predictor: Predictor) -> None:
    data = (MODELS / MODEL_FILE).read_bytes()
    assert predictor.metadata.sha256 == hashlib.sha256(data).hexdigest()
    assert predictor.metadata.sizeBytes == len(data)


def test_pwa_copy_is_identical() -> None:
    for name in (MODEL_FILE, METADATA_FILE):
        assert (CLIENT_MODELS / name).read_bytes() == (MODELS / name).read_bytes(), name


def test_features_and_classes_match_shared_data(predictor: Predictor) -> None:
    symptoms = json.loads((SHARED / "data" / "symptoms.json").read_text(encoding="utf-8"))["symptoms"]
    vocab = {s["id"] for s in symptoms}
    assert set(predictor.metadata.features) <= vocab
    assert len(predictor.metadata.features) == 131
    assert set(predictor.metadata.classes) == {c.id for c in load_conditions(SHARED).conditions}


def test_onnxruntime_reproduces_sklearn_outputs(predictor: Predictor) -> None:
    """parity_fixtures.json holds sklearn predict_proba at export time; Node replays the same file."""
    assert FIXTURES["sha256"] == predictor.metadata.sha256
    assert len(FIXTURES["cases"]) > 100
    for case in FIXTURES["cases"]:
        x, _, _ = predictor.vectorize(case["symptoms"])
        got = predictor.predict_proba(x)[0]
        expected = np.array(case["probabilities"])
        np.testing.assert_allclose(got, expected, atol=FIXTURES["tolerance"], err_msg=str(case["symptoms"]))
        assert int(got.argmax()) == int(expected.argmax())


def test_vectorize(predictor: Predictor) -> None:
    x, known, unmodelled = predictor.vectorize([" Cough", "cough", "vaginal_bleeding", "made_up"])
    assert x.shape == (1, 131)
    assert x.dtype == np.float32
    assert known == 1
    assert unmodelled == ["vaginal_bleeding", "made_up"]


def test_rejects_a_tampered_model(tmp_path) -> None:
    (tmp_path / METADATA_FILE).write_bytes((MODELS / METADATA_FILE).read_bytes())
    (tmp_path / MODEL_FILE).write_bytes((MODELS / MODEL_FILE).read_bytes() + b"\0")
    with pytest.raises(ValueError, match="sha256"):
        Predictor(tmp_path)
