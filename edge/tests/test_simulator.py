import json
import random
from pathlib import Path

import pytest

from simulator.devices import load_devices, parse_broker
from simulator.vitals import ABNORMAL_KINDS, NORMAL, PatientVitals, abnormal_reading, payload

THRESHOLDS = json.loads(
    (Path(__file__).resolve().parents[2] / "shared" / "data" / "vitals.json").read_text(encoding="utf-8")
)["thresholds"]


def alerts(reading: dict) -> dict[str, str]:
    """Python copy of evaluateVitalAlerts() for an adult (shared/src/vitals.ts): code -> severity."""
    best: dict[tuple[str, str], dict] = {}
    # The simulated devices belong to adult patients: thresholds without a band, or the adult band.
    for t in (t for t in THRESHOLDS if t.get("ageBand") in (None, "adult")):
        v = reading.get(t["vital"])
        if v is None or not (v < t["value"] if t["op"] == "lt" else v >= t["value"]):
            continue
        key = (t["vital"], t["op"])
        if key not in best or t["severity"] == "critical":
            best[key] = t
    return {t["code"]: t["severity"] for t in best.values()}


def test_normal_readings_never_raise_alerts() -> None:
    for seed in range(20):
        state = PatientVitals(random.Random(seed))
        for _ in range(500):
            reading = state.next_normal()
            assert alerts(reading) == {}, reading
            for key, spec in NORMAL.items():
                assert spec["lo"] <= reading[key] <= spec["hi"]


EXPECTED = {
    "spo2_low": {"SPO2_LOW": "warning"},
    "spo2_critical": {"SPO2_CRITICAL": "critical"},
    "fever": {"TEMP_HIGH": "warning"},
    "fever_critical": {"TEMP_CRITICAL": "critical"},
    "tachycardia": {"HR_HIGH": "warning"},
    "tachycardia_critical": {"HR_CRITICAL_HIGH": "critical"},
    "bradycardia_critical": {"HR_CRITICAL_LOW": "critical"},
    "hypertension": {"BP_SYSTOLIC_HIGH": "warning", "BP_DIASTOLIC_HIGH": "warning"},
    "hypertensive_crisis": {"BP_SYSTOLIC_CRITICAL": "critical", "BP_DIASTOLIC_CRITICAL": "critical"},
}


@pytest.mark.parametrize("kind", list(ABNORMAL_KINDS))
def test_each_abnormal_kind_raises_the_intended_alert(kind: str) -> None:
    base = PatientVitals(random.Random(0)).snapshot()
    assert alerts(abnormal_reading(base, kind)) == EXPECTED[kind]


def test_unknown_kind() -> None:
    with pytest.raises(ValueError, match="Unknown kind"):
        abnormal_reading({}, "nope")


def test_payload_shape() -> None:
    body = payload({"spo2": 97, "heartRate": 70})
    assert set(body) == {"ts", "spo2", "heartRate"}
    assert body["ts"].endswith("Z")
    assert isinstance(body["spo2"], int)


def write_devices(tmp_path: Path, topic: str | None = None) -> Path:
    pid = "665f00000000000000000a01"
    data = {
        "brokerUrl": "mqtt://localhost:1883",
        "topicPrefix": "ruralcare/vitals",
        "devices": [
            {
                "deviceId": "rc-dev-01",
                "username": "rc-dev-01",
                "password": "x",
                "patientId": pid,
                "patientName": "Test",
                "topic": topic or f"ruralcare/vitals/{pid}/rc-dev-01",
            }
        ],
    }
    path = tmp_path / "devices.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


def test_load_devices(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("MQTT_URL", raising=False)
    broker, devices = load_devices(write_devices(tmp_path))
    assert (broker.host, broker.port) == ("localhost", 1883)
    assert devices[0].topic == "ruralcare/vitals/665f00000000000000000a01/rc-dev-01"


def test_mqtt_url_env_overrides_file(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MQTT_URL", "mqtt://mosquitto:1884")
    broker, _ = load_devices(write_devices(tmp_path))
    assert (broker.host, broker.port) == ("mosquitto", 1884)


def test_rejects_a_mismatched_topic(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="does not match"):
        load_devices(write_devices(tmp_path, topic="ruralcare/vitals/other/rc-dev-01"))


def test_missing_file_explains_how_to_provision(tmp_path: Path) -> None:
    with pytest.raises(FileNotFoundError, match="Seed the database"):
        load_devices(tmp_path / "nope.json")


def test_parse_broker() -> None:
    assert parse_broker("mqtt://10.0.0.5") == parse_broker("mqtt://10.0.0.5:1883")
    with pytest.raises(ValueError):
        parse_broker("http://x")
