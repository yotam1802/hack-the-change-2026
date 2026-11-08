"""Arduino HW-827 -> WaitWatch Express demo bridge.

First 7 individual BPM readings initialize the reference range: remove the
reading furthest from the median; calculate mean and sample standard deviation
of the 6 remaining readings; bounds = floor(mean - std), ceil(mean + std).

Beginning with the 8th reading, use the latest 5 individual BPM readings
(sliding by 1 reading). Remove one outlier (furthest from median), and calculate
mean and sample std of the remaining 4. Update the stored range ONLY when that
new mean is below (current bpmMin - stored std) or above
(current bpmMax + stored std). On an update the new bounds are
floor(new mean - new std), ceil(new mean + new std).

Each valid BPM reading is forwarded, with bpmMin/bpmMax null until sample 7.
The range is a heuristic visualization, NOT a clinically validated heart rate
confidence interval. HW-827 does not measure SpO2, temperature or motion.

Install: python3 -m pip install pyserial
Run: SERIAL=/dev/cu.usbmodemXXXX python3 main.py
Optional: DEMO_STUB_VITALS=1 (simulated SpO2/temp for demos only)
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
from collections import deque
from typing import Any, Iterator

INGEST_URL = os.getenv("INGEST_URL", "http://127.0.0.1:8787/api/readings")
DEVICE_ID = os.getenv("DEVICE_ID", "device-08")
DEVICE_TOKEN = os.getenv("DEVICE_TOKEN", f"dev-{DEVICE_ID}")
SERIAL_BAUD = int(os.getenv("SERIAL_BAUD", "9600"))
INITIAL_COUNT = 7
ROLLING_COUNT = 5
DEMO_STUB_VITALS = os.getenv("DEMO_STUB_VITALS", "0") == "1"
BPM_RE = re.compile(r"\b(?:heart\s*rate|bpm)\s*:\s*(\d+(?:\.\d+)?)\b", re.I)


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
    except (TypeError, ValueError):
        return None
    return bpm if math.isfinite(bpm) and 30 <= bpm <= 220 else None


def calculate_range(values: list[float]) -> tuple[float, float, int, int, float]:
    """Drop exactly one largest median deviation, then mean ± sample std."""
    if len(values) not in (INITIAL_COUNT, ROLLING_COUNT):
        raise ValueError("Expected 7 initial readings or 5 sliding readings")
    midpoint = statistics.median(values)
    outlier_index = max(range(len(values)), key=lambda i: abs(values[i] - midpoint))
    kept = [v for i, v in enumerate(values) if i != outlier_index]
    mean = statistics.mean(kept)
    std = statistics.stdev(kept)
    return mean, std, math.floor(mean - std), math.ceil(mean + std), values[outlier_index]


def make_reading(bpm: float, bpm_min: int | None, bpm_max: int | None) -> dict[str, Any]:
    # Schema-required placeholder fields below are not sensor measurements.
    return {
        "ts": int(time.time() * 1000),
        "bpm": round(bpm, 1),
        "bpmMin": bpm_min,
        "bpmMax": bpm_max,
        "ibiMs": [],
        "signalQuality": 0.0,
        "activity": "rest",  # assumption; not measured
        "motionMag": 0.0,  # unmeasured
        "fallDetected": False,  # unmeasured
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
                candidates = sorted(p for p in existing if "usbmodem" in p or "usbserial" in p)
                if len(candidates) != 1:
                    print(f"Serial device missing: {serial_path}; retrying...", file=sys.stderr)
                    time.sleep(2)
                    continue
                selected = candidates[0]
                serial_path = selected
                print(f"Arduino port changed to {selected}", file=sys.stderr)
            with serial.Serial(selected, SERIAL_BAUD, timeout=1) as port:
                print(f"Connected to {selected} at {SERIAL_BAUD} baud", file=sys.stderr)
                time.sleep(2)  # Arduino often resets when serial opens.
                while True:
                    value = port.readline().decode("utf-8", errors="replace").strip()
                    if value:
                        yield value
        except (serial.SerialException, OSError) as exc:
            print(f"Serial connection lost: {exc}; reconnecting...", file=sys.stderr)
            time.sleep(2)


def post(seq: int, reading: dict[str, Any]) -> None:
    payload = {"deviceId": DEVICE_ID, "seq": seq, "readings": [reading]}
    request = urllib.request.Request(
        INGEST_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {DEVICE_TOKEN}",
        },
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=5) as response:
        if response.status != 202:
            raise RuntimeError(f"Unexpected response: HTTP {response.status}")
        response.read()


def report_error(exc: Exception) -> None:
    if isinstance(exc, urllib.error.HTTPError):
        print(f"POST HTTP {exc.code}: {exc.read().decode('utf-8', 'replace')}", file=sys.stderr)
    else:
        print(f"POST error: {exc}", file=sys.stderr)


def main() -> None:
    print(f"Forwarding to {INGEST_URL} as {DEVICE_ID}", file=sys.stderr)
    print("Initialize on 7 individual readings; then slide 5 raw BPM readings by 1", file=sys.stderr)
    if DEMO_STUB_VITALS:
        print("DEMO MODE: simulated SpO2 and skin temperature; NOT measured", file=sys.stderr)

    initial: list[float] = []
    recent: deque[float] = deque(maxlen=ROLLING_COUNT)
    bpm_min: int | None = None
    bpm_max: int | None = None
    reference_std: float | None = None
    seq = 0
    pending: tuple[int, dict[str, Any]] | None = None

    try:
        for raw in lines():
            bpm = parse_bpm(raw)
            if bpm is None:
                continue

            recent.append(bpm)
            if len(initial) < INITIAL_COUNT:
                initial.append(bpm)
                print(f"Initial reading {len(initial)}/{INITIAL_COUNT}: {bpm:.1f}", file=sys.stderr)
                if len(initial) == INITIAL_COUNT:
                    mean, reference_std, bpm_min, bpm_max, excluded = calculate_range(initial)
                    print(
                        f"INITIAL RANGE: removed={excluded:.1f}; mean={mean:.2f}; "
                        f"std={reference_std:.2f}; [{bpm_min}, {bpm_max}]",
                        file=sys.stderr,
                    )
            else:
                mean, new_std, new_min, new_max, excluded = calculate_range(list(recent))
                # Compare against previous displayed integer bounds plus/minus
                # ONE stored standard deviation, as requested.
                assert bpm_min is not None and bpm_max is not None and reference_std is not None
                lower_trigger = bpm_min - reference_std
                upper_trigger = bpm_max + reference_std
                if mean < lower_trigger or mean > upper_trigger:
                    bpm_min, bpm_max = new_min, new_max
                    reference_std = new_std
                    print(
                        f"RANGE UPDATED: window={list(recent)} removed={excluded:.1f} "
                        f"mean={mean:.2f}, std={new_std:.2f} -> [{bpm_min}, {bpm_max}]",
                        file=sys.stderr,
                    )
                else:
                    print(
                        f"Range held [{bpm_min}, {bpm_max}]: window mean={mean:.2f}, "
                        f"std={new_std:.2f}; update outside ({lower_trigger:.2f}, {upper_trigger:.2f})",
                        file=sys.stderr,
                    )

            reading = make_reading(bpm, bpm_min, bpm_max)
            # Never change the sequence number of a failed POST. Retry that
            # same payload before the latest one; bound memory to one pending.
            if pending is not None:
                try:
                    post(*pending)
                except (urllib.error.URLError, TimeoutError, RuntimeError) as exc:
                    report_error(exc)
                    print("Skipping current POST while earlier one is pending", file=sys.stderr)
                    continue
                print(f"Sent pending batch {pending[0]}", file=sys.stderr)
                seq += 1
                pending = None
            try:
                post(seq, reading)
            except (urllib.error.URLError, TimeoutError, RuntimeError) as exc:
                report_error(exc)
                pending = (seq, reading)
            else:
                print(f"Sent {seq}: bpm={bpm:.1f}, range=[{bpm_min}, {bpm_max}]", file=sys.stderr)
                seq += 1
    except KeyboardInterrupt:
        print("Stopped by user", file=sys.stderr)
    finally:
        if pending is not None:
            try:
                post(*pending)
                print(f"Sent pending batch {pending[0]}", file=sys.stderr)
            except (urllib.error.URLError, TimeoutError, RuntimeError) as exc:
                report_error(exc)
                print("Pending batch was not sent", file=sys.stderr)


if __name__ == "__main__":
    main()
