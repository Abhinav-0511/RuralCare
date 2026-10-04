import copy
import json
import math

import pytest

from app.config import REPO_ROOT
from app.safety import RedFlagEngine, TriageContext

SHARED = REPO_ROOT / "shared"
GOLDEN = json.loads((SHARED / "tests" / "red_flag_cases.json").read_text(encoding="utf-8"))["cases"]
VOCAB = json.loads((SHARED / "data" / "symptoms.json").read_text(encoding="utf-8"))
LABEL = {"en": "x", "ta": "x", "hi": "x"}


@pytest.fixture(scope="module")
def engine() -> RedFlagEngine:
    return RedFlagEngine.from_shared_dir(SHARED)


# The same file drives shared/src/redFlags.golden.test.ts, so both engines must agree.
@pytest.mark.parametrize("case", GOLDEN, ids=[c["name"] for c in GOLDEN])
def test_golden_case(engine: RedFlagEngine, case: dict) -> None:
    result = engine.evaluate(TriageContext.model_validate(case["input"]))
    expected = case["expected"]

    assert result.is_emergency is expected["isEmergency"]
    assert result.level == ("EMERGENCY" if expected["isEmergency"] else None)
    assert sorted(r.id for r in result.matched_rules) == sorted(expected["matchedRuleIds"])
    if "unknownSymptoms" in expected:
        assert result.unknown_symptoms == expected["unknownSymptoms"]
    if "minimumLevel" in expected:
        assert result.minimum_level == expected["minimumLevel"]
    if "floorIds" in expected:
        assert sorted(f.id for f in result.matched_floors) == sorted(expected["floorIds"])


def _rules(*rules: dict) -> dict:
    return {"version": "test", "rules": list(rules)}


@pytest.mark.parametrize(
    ("when", "match"),
    [
        ({"anySymptoms": ["not_a_symptom"]}, "not_a_symptom"),
        ({"all": [{"ageMonthsLt": 3}, {"any": [{"anySymptoms": ["typo_fever"]}]}]}, "typo_fever"),
        ({"someSymptoms": ["chest_pain"]}, None),
        ({"anySymptoms": ["chest_pain"], "pregnant": True}, None),
        ({"anySymptoms": []}, None),
        ({"pregnant": "yes"}, None),
    ],
    ids=["unknown symptom", "nested unknown symptom", "unknown key", "two keys", "empty list", "wrong type"],
)
def test_invalid_rules_fail_closed(when: dict, match: str | None) -> None:
    with pytest.raises(ValueError, match=match):
        RedFlagEngine(_rules({"id": "RF_X", "label": LABEL, "when": when}), VOCAB)


def test_duplicate_rule_ids_rejected() -> None:
    rule = {"id": "RF_X", "label": LABEL, "when": {"anySymptoms": ["chest_pain"]}}
    with pytest.raises(ValueError, match="Duplicate"):
        RedFlagEngine(_rules(rule, rule), VOCAB)


@pytest.mark.parametrize(
    ("min_level", "symptom", "match"),
    [("EMERGENCY", "cough", None), ("SEE_DOCTOR_24H", "nope", "nope")],
    ids=["floor cannot set EMERGENCY", "floor with unknown symptom"],
)
def test_invalid_floors_fail_closed(min_level: str, symptom: str, match: str | None) -> None:
    raw = _rules({"id": "RF_X", "label": LABEL, "when": {"anySymptoms": ["chest_pain"]}})
    floor = {"id": "FLOOR_X", "label": LABEL, "minLevel": min_level, "when": {"anySymptoms": [symptom]}}
    raw["floors"] = [floor]
    with pytest.raises(ValueError, match=match):
        RedFlagEngine(raw, VOCAB)


def test_missing_translation_rejected() -> None:
    rule = {"id": "RF_X", "label": {"en": "x", "hi": "x"}, "when": {"anySymptoms": ["chest_pain"]}}
    with pytest.raises(ValueError):
        RedFlagEngine(_rules(rule), VOCAB)


def test_duplicate_vocabulary_ids_rejected() -> None:
    vocab = copy.deepcopy(VOCAB)
    vocab["symptoms"].append(vocab["symptoms"][0])
    with pytest.raises(ValueError, match="Duplicate symptom"):
        RedFlagEngine(_rules({"id": "RF_X", "label": LABEL, "when": {"anySymptoms": ["chest_pain"]}}), vocab)


def test_matched_rules_in_file_order(engine: RedFlagEngine) -> None:
    result = engine.evaluate(TriageContext(symptoms=["seizure", "chest_pain"]))
    assert [r.id for r in result.matched_rules] == ["RF_CHEST_PAIN", "RF_SEIZURE"]


def test_non_finite_temperature_treated_as_missing(engine: RedFlagEngine) -> None:
    ctx = TriageContext.model_construct(symptoms=[], age_months=1, pregnant=None, temperature_c=math.nan)
    assert engine.evaluate(ctx).is_emergency is False


def test_context_validation_mirrors_typescript_schema() -> None:
    with pytest.raises(ValueError):
        TriageContext.model_validate({"symptoms": [], "ageMonths": -1})
    with pytest.raises(ValueError):
        TriageContext.model_validate({"symptoms": [], "temperatureC": 50})
    with pytest.raises(ValueError):
        TriageContext.model_validate({"symptoms": [], "unexpected": 1})


def test_same_rule_ids_as_shared_file(engine: RedFlagEngine) -> None:
    raw = json.loads((SHARED / "data" / "red_flags.json").read_text(encoding="utf-8"))
    assert [r.id for r in engine.rules] == [r["id"] for r in raw["rules"]]
    assert [f.id for f in engine.floors] == [f["id"] for f in raw["floors"]]
