"""Reads devices.json written by `npm run devices:provision -w @ruralcare/server`."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse


@dataclass(frozen=True)
class DeviceConfig:
    device_id: str
    username: str
    password: str
    patient_id: str
    patient_name: str | None
    topic: str


@dataclass(frozen=True)
class Broker:
    host: str
    port: int


def parse_broker(url: str) -> Broker:
    u = urlparse(url)
    if u.scheme != "mqtt" or not u.hostname:
        raise ValueError(f"Expected mqtt://host:port, got {url!r}")
    return Broker(u.hostname, u.port or 1883)


def load_devices(path: str | Path) -> tuple[Broker, list[DeviceConfig]]:
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(
            f"{path} not found. Seed the database first (it writes devices.json), or run "
            "`npm run devices:provision -w @ruralcare/server`."
        )
    data = json.loads(path.read_text(encoding="utf-8"))
    # MQTT_URL (e.g. mqtt://mosquitto:1883 inside Docker) overrides the URL in the file.
    broker = parse_broker(os.environ.get("MQTT_URL") or data["brokerUrl"])
    devices = []
    for d in data["devices"]:
        expected = f"{data['topicPrefix']}/{d['patientId']}/{d['deviceId']}"
        if d["topic"] != expected:
            raise ValueError(f"Device {d['deviceId']}: topic {d['topic']} does not match {expected}")
        devices.append(
            DeviceConfig(d["deviceId"], d["username"], d["password"], d["patientId"], d.get("patientName"), d["topic"])
        )
    if not devices:
        raise ValueError(f"No devices in {path}")
    return broker, devices
