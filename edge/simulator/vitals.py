"""Simulated vital signs: a mean-reverting random walk inside normal ranges, plus abnormal overrides."""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from datetime import UTC, datetime

# Normal walk bounds, well inside the alert thresholds in shared/data/vitals.json, so a "normal"
# device never raises an alert by chance.
NORMAL = {
    "heartRate": {"base": 74, "sd": 3.0, "lo": 60, "hi": 100},
    "spo2": {"base": 97, "sd": 0.6, "lo": 95, "hi": 99},
    "temperatureC": {"base": 36.8, "sd": 0.08, "lo": 36.3, "hi": 37.4},
    "systolicBp": {"base": 122, "sd": 2.5, "lo": 108, "hi": 138},
    "diastolicBp": {"base": 80, "sd": 2.0, "lo": 68, "hi": 88},
}

# Abnormal readings for demos. The expected alert code is checked by tests/test_simulator.py.
ABNORMAL_KINDS: dict[str, dict[str, float]] = {
    "spo2_low": {"spo2": 91},
    "spo2_critical": {"spo2": 86},
    "fever": {"temperatureC": 39.8},
    "fever_critical": {"temperatureC": 41.3},
    "tachycardia": {"heartRate": 130},
    "tachycardia_critical": {"heartRate": 160},
    "bradycardia_critical": {"heartRate": 36},
    "hypertension": {"systolicBp": 168, "diastolicBp": 102},
    "hypertensive_crisis": {"systolicBp": 192, "diastolicBp": 124},
}

INTEGER_VITALS = {"heartRate", "spo2", "systolicBp", "diastolicBp"}


@dataclass
class PatientVitals:
    """One device's current state."""

    rng: random.Random
    state: dict[str, float] = field(default_factory=lambda: {k: v["base"] for k, v in NORMAL.items()})

    def next_normal(self) -> dict[str, float]:
        for key, spec in NORMAL.items():
            value = self.state[key]
            value += 0.2 * (spec["base"] - value) + self.rng.gauss(0, spec["sd"])  # pulls back to baseline
            self.state[key] = min(spec["hi"], max(spec["lo"], value))
        return self.snapshot()

    def snapshot(self) -> dict[str, float]:
        return {k: (round(v) if k in INTEGER_VITALS else round(v, 1)) for k, v in self.state.items()}


def abnormal_reading(base: dict[str, float], kind: str) -> dict[str, float]:
    if kind not in ABNORMAL_KINDS:
        raise ValueError(f"Unknown kind {kind!r}. Choose one of: {', '.join(ABNORMAL_KINDS)}")
    return {**base, **ABNORMAL_KINDS[kind]}


def payload(vitals: dict[str, float], at: datetime | None = None) -> dict:
    """Message body the server expects: an ISO timestamp plus any subset of vitals."""
    at = at or datetime.now(UTC)
    return {"ts": at.isoformat(timespec="milliseconds").replace("+00:00", "Z"), **vitals}
