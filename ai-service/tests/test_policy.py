import json

import pytest

from app.config import REPO_ROOT
from app.model.conditions import load_conditions
from app.model.policy import RankedCondition, most_severe, prediction_level

SHARED = REPO_ROOT / "shared"
GOLDEN = json.loads((SHARED / "tests" / "prediction_policy_cases.json").read_text(encoding="utf-8"))["cases"]
CONDITIONS = load_conditions(SHARED)


# Same file as shared/src/model.test.ts: both implementations must agree.
@pytest.mark.parametrize("case", GOLDEN, ids=[c["name"] for c in GOLDEN])
def test_policy_golden_case(case: dict) -> None:
    ranked = [RankedCondition(r["id"], r["probability"]) for r in case["ranked"]]
    result = prediction_level(ranked, case["knownFeatureCount"], case["unmodelledSymptoms"], CONDITIONS)
    assert result.level == case["expected"]["level"]
    assert result.low_confidence is case["expected"]["lowConfidence"]


def test_conditions_file() -> None:
    assert len(CONDITIONS.conditions) == 41
    assert all(c.triageLevel != "EMERGENCY" for c in CONDITIONS.conditions)
    assert CONDITIONS.get("dengue").name.ta == "டெங்கு"
    with pytest.raises(KeyError):
        CONDITIONS.get("nope")


def test_most_severe() -> None:
    assert most_severe("SELF_CARE", "SEE_DOCTOR_24H") == "SEE_DOCTOR_24H"
    assert most_severe("SEE_DOCTOR_24H", "SELF_CARE") == "SEE_DOCTOR_24H"
    assert most_severe("SELF_CARE", None) == "SELF_CARE"
