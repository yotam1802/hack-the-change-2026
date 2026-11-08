"""Forward heart-rate readings from an Arduino serial port to WaitWatch Express.

Accepts JSON lines such as {"bpm": 78}, or text such as:
  Heart Rate: 78 BPM
  Beat detected! BPM: 78
  BPM: 78.5

Requires: pip install pyserial (only for SERIAL mode)
Usage:
  SERIAL=/dev/cu.usbmodemXXXX python3 forward_heart_rate.py
  python3 forward_heart_rate.py < readings.txt
"""

import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from typing import Any, Iterator

INGEST_URL = os.getenv("INGEST_URL", "http://127.0.0.1:8787/api/readings")
DEVICE_ID = os.getenv("DEVICE_ID", "device-08")
DEVICE_TOKEN = os.getenv("DEVICE_TOKEN", f"dev-{DEVICE_ID}")
BATCH_SIZE = int(os.getenv("BATCH", "5"))
# If your Arduino prints an explicit BPM, capture it; don't mistake raw ADC readings for BPM.
BPM_RE = re.compile(r"\b(?:heart\s*rate|bpm)\s*:\s*(\d+(?:\.\d+)?)\b", re.IGNORECASE)

def parse_reading(raw):
    try:
        data = json.loads(raw)
        if not isinstance(data, dict):
            return None
        bpm = data.get("bpm")
    except json.JSONDecodeError:
        match = re.search(
            r"Heart Rate:\s*(\d+(?:\.\d+)?)\s*BPM",
            raw
        )
        if not match:
            return None
        bpm = float(match.group(1))

    if bpm is not None:
        bpm = float(bpm)
        if not 30 <= bpm <= 220:
            return None

    return {
        "ts": int(time.time() * 1000),
        "bpm": bpm,
        "ibiMs": [],
        "signalQuality": 0,
        "activity": "rest",
        "motionMag": 0,
        "fallDetected": False,
        "skinTempC": None,
        "spo2": None,
        "spo2Simulated": True
    }


def lines() -> Iterator[str]:
    serial_path = os.getenv("SERIAL")
    if serial_path:
        try:
            import serial
        except ImportError as exc:
            raise SystemExit("Missing pyserial: run python3 -m pip install pyserial") from exc
        # Keep Arduino Serial Monitor closed: only one program may own the port.
        with serial.Serial(serial_path, 9600, timeout=1) as port:
            # Many Arduino boards reset when a serial connection is opened.
            time.sleep(2)
            while True:
                line = port.readline().decode("utf-8", errors="replace").strip()
                if line:
                    yield line
    else:
        for line in sys.stdin:
            line = line.strip()
            if line:
                yield line


def post(seq: int, readings: list[dict[str, Any]]) -> None:
    body = json.dumps({"deviceId": DEVICE_ID, "seq": seq, "readings": readings}).encode("utf-8")
    request = urllib.request.Request(
        INGEST_URL,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {DEVICE_TOKEN}",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=5) as response:
        response.read()


def main() -> None:
    if BATCH_SIZE < 1:
        raise SystemExit("BATCH must be at least 1")
    seq = 0
    batch: list[dict[str, Any]] = []
    print(f"Forwarding readings to {INGEST_URL} as {DEVICE_ID} (batch={BATCH_SIZE})", file=sys.stderr)
    try:
        for raw in lines():
            reading = parse_reading(raw)
            if reading is None:
                continue
            batch.append(reading)
            print(f"Read BPM: {reading['bpm']}", file=sys.stderr)
            if len(batch) >= BATCH_SIZE:
                try:
                    post(seq, batch)
                except (urllib.error.URLError, TimeoutError) as exc:
                    print(f"POST failed for batch {seq}: {exc}; will retry next reading", file=sys.stderr)
                    continue
                print(f"Sent batch {seq}: {len(batch)} readings", file=sys.stderr)
                seq += 1
                batch.clear()
    except KeyboardInterrupt:
        print("Stopped by user", file=sys.stderr)
    finally:
        if batch:
            try:
                post(seq, batch)
                print(f"Sent final batch {seq}: {len(batch)} readings", file=sys.stderr)
            except (urllib.error.URLError, TimeoutError) as exc:
                print(f"Could not send final batch: {exc}", file=sys.stderr)


if __name__ == "__main__":
    main()
