"""Model output -> triage level. Line-for-line port of predictionLevel() in shared/src/model.ts.

Both implementations are tested against shared/tests/prediction_policy_cases.json.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from app.model.conditions import ConditionsFile
from app.safety.red_flags import TRIAGE_LEVELS


@dataclass(frozen=True)
class RankedCondition:
    id: str
    probability: float


@dataclass(frozen=True)
class PolicyResult:
    level: str
    low_confidence: bool


def most_severe(a: str, b: str | None) -> str:
    """TRIAGE_LEVELS is ordered most -> least severe."""
    if b is None:
        return a
    return b if TRIAGE_LEVELS.index(b) < TRIAGE_LEVELS.index(a) else a


def prediction_level(
    ranked: Sequence[RankedCondition],
    known_feature_count: int,
    unmodelled_symptoms: Sequence[str],
    conditions: ConditionsFile,
) -> PolicyResult:
    policy = conditions.policy
    if known_feature_count == 0 or not ranked:
        return PolicyResult("SEE_DOCTOR_SOON", True)

    top = ranked[0]
    level = conditions.get(top.id).triageLevel
    for runner_up in ranked[1 : policy.topK]:
        if runner_up.probability >= policy.escalateRunnerUpMinProbability:
            level = most_severe(level, conditions.get(runner_up.id).triageLevel)
    low_confidence = top.probability < policy.minConfidence
    if low_confidence or unmodelled_symptoms:
        level = most_severe(level, "SEE_DOCTOR_SOON")
    return PolicyResult(level, low_confidence)
