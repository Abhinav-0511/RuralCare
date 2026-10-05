"""RuralCare vitals device simulator.

  python -m simulator run                 # every device publishes normal vitals every few seconds
  python -m simulator inject --device rc-dev-02 --kind spo2_critical   # one abnormal reading, now
  python -m simulator kinds               # list abnormal reading kinds

In Docker:  docker compose -f infra/docker-compose.yml --profile edge exec edge-simulator \\
              python -m simulator inject --device rc-dev-02 --kind spo2_critical
"""

from __future__ import annotations

import argparse
import json
import os
import random
import signal
import sys
import threading
import time

import paho.mqtt.client as mqtt

from simulator.devices import Broker, DeviceConfig, load_devices
from simulator.vitals import ABNORMAL_KINDS, PatientVitals, abnormal_reading, payload

# Written by the seed into infra/mosquitto/generated/ (mounted at /app/generated in Docker).
DEFAULT_DEVICES_FILE = os.environ.get("DEVICES_FILE", "../infra/mosquitto/generated/devices.json")


def connect(broker: Broker, device: DeviceConfig, suffix: str = "") -> mqtt.Client:
    client = mqtt.Client(
        callback_api_version=mqtt.CallbackAPIVersion.VERSION2,
        client_id=f"{device.device_id}{suffix}",
        protocol=mqtt.MQTTv5,
    )
    client.username_pw_set(device.username, device.password)
    client.connect(broker.host, broker.port, keepalive=30)
    client.loop_start()
    return client


def publish(client: mqtt.Client, device: DeviceConfig, vitals: dict) -> None:
    body = json.dumps(payload(vitals))
    info = client.publish(device.topic, body, qos=1)
    info.wait_for_publish(timeout=5)
    print(f"{device.device_id} -> {body}", flush=True)


def wait_for_devices(path: str, stop: threading.Event) -> float | None:
    """Blocks until devices.json exists (the seed writes it). Returns its mtime, or None if stopped."""
    hinted = False
    while not stop.is_set():
        try:
            return os.stat(path).st_mtime
        except FileNotFoundError:
            if not hinted:
                print(f"Waiting for {path} (it is written when the database is seeded)...", flush=True)
                hinted = True
            stop.wait(3)
    return None


def run(args: argparse.Namespace) -> int:
    stop = threading.Event()
    signal.signal(signal.SIGTERM, lambda *_: stop.set())
    signal.signal(signal.SIGINT, lambda *_: stop.set())
    rng = random.Random(args.seed)

    while not stop.is_set():
        mtime = wait_for_devices(args.devices, stop)
        if mtime is None:
            break
        broker, devices = load_devices(args.devices)
        clients = [(d, connect(broker, d), PatientVitals(random.Random(rng.random()))) for d in devices]
        print(
            f"Publishing for {len(clients)} devices every {args.interval}s to {broker.host}:{broker.port}", flush=True
        )
        try:
            while not stop.is_set():
                for device, client, state in clients:
                    vitals = state.next_normal()
                    if args.abnormal_rate and rng.random() < args.abnormal_rate:
                        vitals = abnormal_reading(vitals, rng.choice(list(ABNORMAL_KINDS)))
                    publish(client, device, vitals)
                stop.wait(args.interval + rng.uniform(-0.3, 0.3))
                # Re-seeding writes new credentials: reconnect with them.
                if wait_for_devices(args.devices, stop) != mtime:
                    print("devices.json changed, reconnecting with the new credentials", flush=True)
                    stop.wait(2)  # let the broker reload first
                    break
        finally:
            for _, client, _ in clients:
                client.loop_stop()
                client.disconnect()
    return 0


def inject(args: argparse.Namespace) -> int:
    broker, devices = load_devices(args.devices)
    device = next((d for d in devices if d.device_id == args.device), None)
    if device is None:
        print(f"Unknown device {args.device}. Known: {', '.join(d.device_id for d in devices)}", file=sys.stderr)
        return 1
    # A separate client id, so it can run alongside `run` for the same device.
    client = connect(broker, device, suffix="-inject")
    try:
        base = PatientVitals(random.Random()).snapshot()
        for i in range(args.count):
            publish(client, device, abnormal_reading(base, args.kind))
            if i < args.count - 1:
                time.sleep(1)
    finally:
        client.loop_stop()
        client.disconnect()
    print(f"Injected {args.count} '{args.kind}' reading(s) for {device.patient_name or device.patient_id}")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="simulator", description=__doc__, formatter_class=argparse.RawTextHelpFormatter
    )
    parser.add_argument("--devices", default=DEFAULT_DEVICES_FILE, help="devices.json from devices:provision")
    sub = parser.add_subparsers(dest="command", required=True)

    p_run = sub.add_parser("run", help="publish normal vitals for every device")
    p_run.add_argument("--interval", type=float, default=float(os.environ.get("PUBLISH_INTERVAL_SECONDS", 5)))
    p_run.add_argument("--abnormal-rate", type=float, default=float(os.environ.get("ABNORMAL_RATE", 0)))
    p_run.add_argument("--seed", type=int, default=None)
    p_run.set_defaults(func=run)

    p_inj = sub.add_parser("inject", help="publish an abnormal reading now")
    p_inj.add_argument("--device", required=True)
    p_inj.add_argument("--kind", required=True, choices=list(ABNORMAL_KINDS))
    p_inj.add_argument("--count", type=int, default=1)
    p_inj.set_defaults(func=inject)

    p_kinds = sub.add_parser("kinds", help="list abnormal kinds")
    p_kinds.set_defaults(func=lambda _: print("\n".join(f"{k:22s} {v}" for k, v in ABNORMAL_KINDS.items())) or 0)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
