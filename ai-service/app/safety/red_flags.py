"""Deterministic red-flag rule engine (Python port of shared/src/redFlags.ts).

Reads the same JSON files in /shared as the TypeScript engine. Both engines are tested
against shared/tests/red_flag_cases.json, so the offline (browser) and online (server)
paths cannot drift. Any match means EMERGENCY and the ML model must not be called.
"""

from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Literal, Union

from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from pydantic.alias_generators import to_camel

NonEmptyStr = Annotated[str, StringConstraints(min_length=1)]
SymptomList = Annotated[list[str], Field(min_length=1)]
SymptomId = Annotated[str, StringConstraints(min_length=1, max_length=64)]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, strict=True)


class LocalizedText(_Strict):
    en: NonEmptyStr
    ta: NonEmptyStr
    hi: NonEmptyStr


# ───────────── Condition grammar (each object has exactly one key) ─────────────


class AnySymptoms(_Strict):
    anySymptoms: SymptomList  # noqa: N815 (JSON key)


class AllSymptoms(_Strict):
    allSymptoms: SymptomList  # noqa: N815


class AgeMonthsLt(_Strict):
    ageMonthsLt: Annotated[float, Field(ge=0)]  # noqa: N815


class AgeMonthsGte(_Strict):
    ageMonthsGte: Annotated[float, Field(ge=0)]  # noqa: N815


class Pregnant(_Strict):
    pregnant: bool


class TemperatureCGte(_Strict):
    temperatureCGte: float  # noqa: N815


class AllOf(_Strict):
    all: Annotated[list[Condition], Field(min_length=1)]


class AnyOf(_Strict):
    any: Annotated[list[Condition], Field(min_length=1)]


Condition = Union[  # noqa: UP007
    AnySymptoms, AllSymptoms, AgeMonthsLt, AgeMonthsGte, Pregnant, TemperatureCGte, AllOf, AnyOf
]
AllOf.model_rebuild()
AnyOf.model_rebuild()


class RedFlagRule(_Strict):
    id: Annotated[str, StringConstraints(pattern=r"^RF_[A-Z0-9_]+$")]
    label: LocalizedText
    when: Condition


class RedFlagRuleSet(_Strict):
    version: str
    notes: str | None = None
    rules: Annotated[list[RedFlagRule], Field(min_length=1)]


class Symptom(_Strict):
    id: Annotated[str, StringConstraints(pattern=r"^[a-z0-9_]+$")]
    category: str
    label: LocalizedText


class SymptomVocabulary(_Strict):
    version: str
    notes: str | None = None
    categories: Annotated[list[str], Field(min_length=1)]
    symptoms: Annotated[list[Symptom], Field(min_length=1)]


# ───────────── Engine input / output ─────────────


class TriageContext(BaseModel):
    """Patient context. Mirrors TriageContextSchema in shared/src/schemas.ts (camelCase in JSON)."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="forbid")

    symptoms: Annotated[list[SymptomId], Field(max_length=50)]
    age_months: Annotated[int, Field(ge=0, le=1500)] | None = None
    pregnant: bool | None = None
    temperature_c: Annotated[float, Field(ge=30, le=45)] | None = None


@dataclass(frozen=True)
class RedFlagResult:
    is_emergency: bool
    level: Literal["EMERGENCY"] | None
    matched_rules: list[RedFlagRule]
    unknown_symptoms: list[str]
    rules_version: str


@dataclass(frozen=True)
class _NormalizedContext:
    symptoms: frozenset[str]
    age_months: float | None
    pregnant: bool | None
    temperature_c: float | None


def _finite_or_none(n: float | None) -> float | None:
    return n if isinstance(n, (int, float)) and math.isfinite(n) else None


def normalize_symptom_id(s: str) -> str:
    return s.strip().lower()


def _evaluate(c: Condition, ctx: _NormalizedContext) -> bool:
    # Missing context values never match: an unknown age can't trigger an infant rule.
    match c:
        case AnySymptoms(anySymptoms=ids):
            return any(s in ctx.symptoms for s in ids)
        case AllSymptoms(allSymptoms=ids):
            return all(s in ctx.symptoms for s in ids)
        case AgeMonthsLt(ageMonthsLt=v):
            return ctx.age_months is not None and ctx.age_months < v
        case AgeMonthsGte(ageMonthsGte=v):
            return ctx.age_months is not None and ctx.age_months >= v
        case Pregnant(pregnant=v):
            return ctx.pregnant is not None and ctx.pregnant == v
        case TemperatureCGte(temperatureCGte=v):
            return ctx.temperature_c is not None and ctx.temperature_c >= v
        case AllOf(all=subs):
            return all(_evaluate(sub, ctx) for sub in subs)
        case AnyOf(any=subs):
            return any(_evaluate(sub, ctx) for sub in subs)
    raise ValueError(f"Unknown red-flag condition: {c!r}")


def _referenced_symptoms(c: Condition) -> list[str]:
    match c:
        case AnySymptoms(anySymptoms=ids) | AllSymptoms(allSymptoms=ids):
            return list(ids)
        case AllOf(all=subs) | AnyOf(any=subs):
            return [s for sub in subs for s in _referenced_symptoms(sub)]
    return []


class RedFlagEngine:
    """Validates the rule file on construction and raises ValueError if anything is wrong.

    A broken rule file must stop the service loudly rather than silently skip emergencies.
    (pydantic's ValidationError is a ValueError subclass.)
    """

    def __init__(self, raw_rules: object, raw_vocabulary: object) -> None:
        self._rule_set = RedFlagRuleSet.model_validate(raw_rules)
        vocabulary = SymptomVocabulary.model_validate(raw_vocabulary)

        ids = [s.id for s in vocabulary.symptoms]
        if len(ids) != len(set(ids)):
            raise ValueError("Duplicate symptom id in vocabulary")
        for s in vocabulary.symptoms:
            if s.category not in vocabulary.categories:
                raise ValueError(f"Symptom {s.id} has unknown category {s.category}")
        self._known = frozenset(ids)

        seen: set[str] = set()
        for rule in self._rule_set.rules:
            if rule.id in seen:
                raise ValueError(f"Duplicate red-flag rule id: {rule.id}")
            seen.add(rule.id)
            for s in _referenced_symptoms(rule.when):
                if s not in self._known:
                    raise ValueError(f'Rule {rule.id} references unknown symptom "{s}"')

    @classmethod
    def from_shared_dir(cls, shared_dir: Path) -> RedFlagEngine:
        data = Path(shared_dir) / "data"
        rules = json.loads((data / "red_flags.json").read_text(encoding="utf-8"))
        vocabulary = json.loads((data / "symptoms.json").read_text(encoding="utf-8"))
        return cls(rules, vocabulary)

    @property
    def rules_version(self) -> str:
        return self._rule_set.version

    @property
    def rules(self) -> list[RedFlagRule]:
        return list(self._rule_set.rules)

    def evaluate(self, ctx: TriageContext) -> RedFlagResult:
        symptoms: set[str] = set()
        unknown: list[str] = []
        for raw in ctx.symptoms:
            sid = normalize_symptom_id(raw)
            if sid in self._known:
                symptoms.add(sid)
            elif sid not in unknown:
                unknown.append(sid)

        norm = _NormalizedContext(
            symptoms=frozenset(symptoms),
            age_months=_finite_or_none(ctx.age_months),
            pregnant=ctx.pregnant,
            temperature_c=_finite_or_none(ctx.temperature_c),
        )
        matched = [r for r in self._rule_set.rules if _evaluate(r.when, norm)]
        return RedFlagResult(
            is_emergency=bool(matched),
            level="EMERGENCY" if matched else None,
            matched_rules=matched,
            unknown_symptoms=unknown,
            rules_version=self._rule_set.version,
        )
