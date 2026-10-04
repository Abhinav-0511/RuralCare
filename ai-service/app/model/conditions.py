"""Loads shared/data/conditions.json and shared/data/triage_levels.json (same files the PWA uses)."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, model_validator

from app.safety.red_flags import LocalizedText, NonEmergencyLevelId, TriageLevelId


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class PredictionPolicy(_Strict):
    topK: Annotated[int, Field(ge=1, le=10)]  # noqa: N815 (JSON key)
    minConfidence: Annotated[float, Field(ge=0, le=1)]  # noqa: N815
    escalateRunnerUpMinProbability: Annotated[float, Field(ge=0, le=1)]  # noqa: N815
    notes: str | None = None


class MedicalCondition(_Strict):
    id: Annotated[str, StringConstraints(pattern=r"^[a-z0-9_]+$")]
    datasetName: str  # noqa: N815
    triageLevel: NonEmergencyLevelId  # noqa: N815
    name: LocalizedText
    advice: LocalizedText


class ConditionsFile(_Strict):
    version: str
    notes: str | None = None
    policy: PredictionPolicy
    conditions: Annotated[list[MedicalCondition], Field(min_length=1)]

    @model_validator(mode="after")
    def _unique_ids(self) -> ConditionsFile:
        ids = [c.id for c in self.conditions]
        if len(ids) != len(set(ids)):
            raise ValueError("Duplicate condition id")
        return self

    def get(self, condition_id: str) -> MedicalCondition:
        for c in self.conditions:
            if c.id == condition_id:
                return c
        raise KeyError(condition_id)

    def by_dataset_name(self) -> dict[str, MedicalCondition]:
        return {c.datasetName: c for c in self.conditions}


class _Level(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)
    id: TriageLevelId
    advice: LocalizedText


class TriageLevelsFile(BaseModel):
    model_config = ConfigDict(extra="ignore", frozen=True)
    disclaimer: LocalizedText
    levels: list[_Level]

    def advice(self, level: str) -> LocalizedText:
        return next(lvl.advice for lvl in self.levels if lvl.id == level)


def load_conditions(shared_dir: Path) -> ConditionsFile:
    return ConditionsFile.model_validate(
        json.loads((Path(shared_dir) / "data" / "conditions.json").read_text(encoding="utf-8"))
    )


def load_triage_levels(shared_dir: Path) -> TriageLevelsFile:
    return TriageLevelsFile.model_validate(
        json.loads((Path(shared_dir) / "data" / "triage_levels.json").read_text(encoding="utf-8"))
    )
