"""Arduino HW-827 -> WaitWatch Express (demo bridge).

Reads text lines like 'Heart Rate: 78 BPM' or JSON objects with a 'bpm' key.
For each group of 5 detected BPM values, rejects outliers, averages the
remaining values, updates a slowly-changing baseline, and POSTs one reading.

Non-BPM measurements are NOT provided by the HW-827. Demo stubs are only
included when DEMO_STUB_VITALS=1; never use these for clinical decisions.

Install: python3 -m pip install pyserial
Run: SERIAL=/dev/cu.usbmodemXXXX python3 main.py
Optional: DEMO_STUB_VITALS=1 (fake SpO2/skin temperature for demos only)
"""

import json
import math
import os
import re
import statistics
import sys
import time
import urllib.error
import urllib.request
from typing import Any, Iterator

INGEST_URL = os.getenv("INGEST_URL", "http://127.0.0.1:8787/api/readings")
DEVICE_ID = os.getenv("DEVICE_ID", "device-08")
DEVICE_TOKEN = os.getenv("DEVICE_TOKEN", f"dev-{DEVICE_ID}")
SERIAL_BAUD = int(os.getenv("SERIAL_BAUD", "9600"))
WINDOW_SIZE = 5
BASELINE_ALPHA = 0.15  # slow adaptation; baseline is for display/debug, not a medical baseline
DEMO_STUB_VITALS = os.getenv("DEMO_STUB_VITALS", "0") == "1"
BPM_RE = re.compile(r"\b(?:heart\s*rate|bpm)\s*:\s*(\d+(?:\.\d+)?)\b", re.IGNORECASE)


def parse_bpm(raw: str) -> float | None:
    try:
        obj = json.loads(raw)
    except json.JSONDecodeError:
        obj = None
    if isinstance(obj, dict):
        value = obj.get("bpm")
    else:
        match = BPM_RE.search(raw)
        value = match.group(1) if match else None
    try:
        bpm = float(value)
    except (ValueError, TypeError):
        return None
    # Sanity bounds alone cannot guarantee the signal reflects a real pulse.
    if not math.isfinite(bpm) or not 30 <= bpm <= 220:
        return None
    return bpm


def filter_window(values: list[float]) -> tuple[float | None, list[float]]:
    """Reject points far from median, then mean the remaining readings.

    Median absolute deviation (MAD) is robust for groups of just five;
    mean+standard deviation alone can be distorted by a large spike.
    This is heuristic filtering, NOT a clinically validated HR algorithm.
    """
    median = statistics.median(values)
    mad = statistics.median(abs(x - median) for x in values)
    tolerance = max(12.0, 2.5 * 1.4826 * mad)
    kept = [x for x in values if abs(x - median) <= tolerance]
    if len(kept) < 3:
        return None, kept
    return round(statistics.mean(kept), 1), kept


def make_reading(filtered_bpm: float) -> dict[str, Any]:
    # Required fields of @waitwatch/shared readingSchema.
    # There is no sensor-derived motion, activity, fall, quality, SpO2 or temp.
    # The current schema cannot mark every field as simulated. For actual
    # patient workflows, make these unmeasured fields nullable/optional and
    # add simulation/source metadata; do not treat these stubs as observations.
    return {
        "ts": int(time.time() * 1000),
        "bpm": filtered_bpm,
        "ibiMs": [],  # cannot infer beat-to-beat intervals from reported BPM
        "signalQuality": 0.0,  # quality not validated; conservative placeholder
        "activity": "rest",  # schema-required assumption; NOT measured
        "motionMag": 0.0,  # schema-required placeholder; NOT measured
        "fallDetected": False,  # schema-required placeholder; NOT measured
        "skinTempC": 33.0 if DEMO_STUB_VITALS else None,
        "spo2": 98.0 if DEMO_STUB_VITALS else None,
        "spo2Simulated": True,
    }


def lines() -> Iterator[str]:
    serial_path = os.getenv("SERIAL")
    if not serial_path:
        for line in sys.stdin:
            if line.strip():
                yield line.strip()
        return
    try:
        import serial
        from serial.tools import list_ports
    except ImportError as exc:
        raise SystemExit("Install pyserial: python3 -m pip install pyserial") from exc

    while True:
        try:
            existing = {port.device for port in list_ports.comports()}
            selected = serial_path
            if selected not in existing:
                candidates = sorted(p for p in existing if "usbmodem" in p)
                if len(candidates) != 1:
                    print(f"Serial device missing: {serial_path}; checking again...", file=sys.stderr)
                    time.sleep(2)
                    continue
                selected = candidates[0]
                serial_path = selected
                print(f"Arduino port changed to {selected}", file=sys.stderr)
            with serial.Serial(selected, SERIAL_BAUD, timeout=1) as port:
                print(f"Connected to {selected} at {SERIAL_BAUD} baud", file=sys.stderr)
                time.sleep(2)  # board often resets on connection
                while True:
                    value = port.readline().decode("utf-8", errors="replace").strip()
                    if value:
                        yield value
        except (serial.SerialException, OSError) as exc:
            print(f"Serial connection lost: {exc}; reconnecting...", file=sys.stderr)
            time.sleep(2)


def post(seq: int, reading: dict[str, Any]) -> None:
    payload = {"deviceId": DEVICE_ID, "seq": seq, "readings": [reading]}
    req = urllib.request.Request(
        INGEST_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {DEVICE_TOKEN}",
        },
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=5) as response:
        if response.status != 202:
            raise RuntimeError(f"Unexpected response: HTTP {response.status}")
        response.read()


def main() -> None:
    print(f"Forwarding filtered BPM to {INGEST_URL} as {DEVICE_ID} (5 samples -> 1 reading)", file=sys.stderr)
    if DEMO_STUB_VITALS:
        print("DEMO MODE: fake SpO2=98% and skinTempC=33C; NOT measured", file=sys.stderr)
    seq = 0
    baseline: float | None = None
    window: list[float] = []
    pending: tuple[int, dict[str, Any]] | None = None

    try:
        for raw in lines():
            bpm = parse_bpm(raw)
            if bpm is None:
                continue
            print(f"Read BPM: {bpm:.1f}", file=sys.stderr)
            window.append(bpm)

            # Never silently discard a failed send: retry the same payload and
            # sequence number on the next incoming reading. Bound memory at 5.
            if pending is not None:
                try:
                    post(*pending)
                except (urllib.error.URLError, TimeoutError, RuntimeError) as exc:
                    if isinstance(exc, urllib.error.HTTPError):
                        print(f"POST HTTP {exc.code}: {exc.read().decode('utf-8', 'replace')}", file=sys.stderr)
                    else:
                        print(f"POST retry failed: {exc}", file=sys.stderr)
                else:
                    print(f"Sent batch {pending[0]} (1 filtered reading)", file=sys.stderr)
                    seq += 1
                    pending = None

            if len(window) < WINDOW_SIZE:
                continue
            if pending is not None:
                # Do not silently accumulate unlimited old measurements.
                window.clear()
                print("Skipping filtered window while previous send is pending", file=sys.stderr)
                continue

            filtered, kept = filter_window(window)
            print(f"Window: {window}; accepted: {kept}", file=sys.stderr)
            window.clear()
            if filtered is None:
                print("Too few consistent readings; no BPM sent", file=sys.stderr)
                continue
            baseline = filtered if baseline is None else (
                BASELINE_ALPHA * filtered + (1 - BASELINE_ALPHA) * baseline
            )
            # Send the filtered 5-sample average; baseline is a separate,
            # slow-trending reference and is not substituted for the reading.
            print(f"Filtered BPM: {filtered:.1f}; trend baseline: {baseline:.1f}", file=sys.stderr)
            reading = make_reading(filtered)
            try:
                post(seq, reading)
            except (urllib.error.URLError, TimeoutError, RuntimeError) as exc:
                if isinstance(exc, urllib.error.HTTPError):
                    print(f"POST HTTP {exc.code}: {exc.read().decode('utf-8', 'replace')}", file=sys.stderr)
                else:
                    print(f"POST failed: {exc}", file=sys.stderr)
                pending = (seq, reading)
            else:
                print(f"Sent batch {seq}: 1 filtered reading", file=sys.stderr)
                seq += 1
    except KeyboardInterrupt:
        print("Stopped by user", file=sys.stderr)
    finally:
        if pending:
            try:
                post(*pending)
                print(f"Sent pending batch {pending[0]}", file=sys.stderr)
            except (urllib.error.URLError, TimeoutError, RuntimeError) as exc:
                print(f"Pending batch not sent: {exc}", file=sys.stderr)


if __name__ == "__main__":
    main()
