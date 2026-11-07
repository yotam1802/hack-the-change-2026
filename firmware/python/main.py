"""Forward Uno Q readings to WaitWatch.

Reads one JSON object per line from the App Lab bridge (or from the MCU serial
port) and posts a batch every five readings with the device token.
"""

import json
import os
import sys
import urllib.request

INGEST_URL = os.environ.get("INGEST_URL", "http://127.0.0.1:8787/api/readings")
DEVICE_ID = os.environ.get("DEVICE_ID", "device-02")
DEVICE_TOKEN = os.environ.get("DEVICE_TOKEN", f"dev-{DEVICE_ID}")
BATCH = 5


def post(seq: int, readings: list) -> None:
    body = json.dumps({"deviceId": DEVICE_ID, "seq": seq, "readings": readings}).encode()
    request = urllib.request.Request(
        INGEST_URL,
        data=body,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {DEVICE_TOKEN}"},
    )
    with urllib.request.urlopen(request, timeout=5) as response:
        response.read()


def lines():
    serial_path = os.environ.get("SERIAL")
    if serial_path:
        import serial  # pyserial, optional

        port = serial.Serial(serial_path, 115200, timeout=2)
        while True:
            raw = port.readline().decode("utf-8", "ignore").strip()
            if raw:
                yield raw
        return
    for raw in sys.stdin:
        raw = raw.strip()
        if raw:
            yield raw


def main() -> None:
    seq = 0
    buffer = []
    for raw in lines():
        try:
            reading = json.loads(raw)
        except json.JSONDecodeError:
            continue
        reading.setdefault("spo2", None)
        reading.setdefault("spo2Simulated", True)
        reading.setdefault("ibiMs", [])
        buffer.append(reading)
        if len(buffer) >= BATCH:
            post(seq, buffer[:BATCH])
            seq += 1
            buffer = buffer[BATCH:]


if __name__ == "__main__":
    main()
