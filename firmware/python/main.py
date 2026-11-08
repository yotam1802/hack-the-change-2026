"""HW-827 -> WaitWatch filtered pulse bridge (device-08).

Sensor BPM samples determine a filtered BPM and range:
  - First 7 valid BPM readings: drop one largest deviation from the median;
    mean +/- sample standard deviation of the remaining 6.
  - Each subsequent BPM sample: examine the most recent 5 raw samples,
    discard one outlier and calculate mean +/- sample std of the remaining 4.
  - ALWAYS recalculate integer bounds from the latest rolling mean +/- std,
    even when the new mean remains inside the previous range.

Transmit once for each valid BPM calculated and printed by the Arduino.
After calibration the BPM is the latest filtered mean of the retained sensor
readings, and the accompanying range is rebuilt from that same mean +/- std.
There is no timer and no invented BPM.
When the Arduino stops reporting, the bridge stops sending new readings.
The statistical range is heuristic, not a validated confidence interval.
HW-827 cannot measure SpO2, temperature or motion. Do not use this bridge
for clinical monitoring, diagnosis, alerts or triage.

Install: python3 -m pip install pyserial
Run: SERIAL=/dev/cu.usbmodemXXXX python3 main.py
Optional: DEMO_STUB_VITALS=0 to send null temperature/SpO2
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
# These are DEMO defaults, not measured values.
DEMO_STUB_VITALS = os.getenv("DEMO_STUB_VITALS", "1") == "1"
DEMO_SKIN_TEMP_C = 33.4
DEMO_SPO2 = 98.0
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
    """Remove one extreme point; calculate mean, sample std and rounded bounds."""
    if len(values) not in (INITIAL_COUNT, ROLLING_COUNT):
        raise ValueError("Expected 7 initial readings or 5 rolling readings")
    median = statistics.median(values)
    outlier_index = max(range(len(values)), key=lambda i: abs(values[i] - median))
    kept = [v for i, v in enumerate(values) if i != outlier_index]
    mean = statistics.mean(kept)
    std = statistics.stdev(kept)
    return mean, std, math.floor(mean - std), math.ceil(mean + std), values[outlier_index]


class BpmRange:
    """Maintain the last computed range as new sensor BPM samples arrive."""

    def __init__(self) -> None:
        self.initial: list[float] = []
        self.recent: deque[float] = deque(maxlen=ROLLING_COUNT)
        self.bpm_min: int | None = None
        self.bpm_max: int | None = None
        self.last_measured_bpm: float | None = None
        self.filtered_bpm: float | None = None

    def add_sample(self, bpm: float) -> None:
        self.last_measured_bpm = bpm
        self.recent.append(bpm)
        if len(self.initial) < INITIAL_COUNT:
            self.initial.append(bpm)
            print(f"Calibration {len(self.initial)}/{INITIAL_COUNT}: {bpm:.1f} BPM", file=sys.stderr)
            if len(self.initial) == INITIAL_COUNT:
                mean, std, self.bpm_min, self.bpm_max, removed = calculate_range(self.initial)
                self.filtered_bpm = mean
                print(
                    f"INITIAL RANGE: removed={removed:.1f}, mean={mean:.2f}, "
                    f"std={std:.2f} -> [{self.bpm_min}, {self.bpm_max}]",
                    file=sys.stderr,
                )
            return

        mean, std, self.bpm_min, self.bpm_max, removed = calculate_range(list(self.recent))
        self.filtered_bpm = mean
        print(
            f"RANGE RECALCULATED: window={list(self.recent)}, removed={removed:.1f}, "
            f"mean={mean:.2f}, std={std:.2f} -> [{self.bpm_min}, {self.bpm_max}]",
            file=sys.stderr,
        )

    def current_bpm(self) -> float | None:
        """Current sensor-derived estimate (called for each new Arduino BPM)."""
        if self.bpm_min is None or self.bpm_max is None:
            # During calibration there is not yet a filtered baseline.
            return self.last_measured_bpm
        if self.filtered_bpm is None:
            return None
        return round(self.filtered_bpm, 1)


def make_reading(bpm: float | None, bpm_min: int | None, bpm_max: int | None) -> dict[str, Any]:
    # All non-BPM fields below are schema-required placeholders or demo stubs.
    return {
        "ts": int(time.time() * 1000),
        "bpm": bpm,
        "bpmMin": bpm_min,
        "bpmMax": bpm_max,
        "ibiMs": [],
        "signalQuality": 0.0,
        "activity": "rest",  # not measured
        "motionMag": 0.0,  # not measured
        "fallDetected": False,  # not measured
        "skinTempC": DEMO_SKIN_TEMP_C if DEMO_STUB_VITALS else None,
        "spo2": DEMO_SPO2 if DEMO_STUB_VITALS else None,
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
            available = {p.device for p in list_ports.comports()}
            selected = serial_path
            if selected not in available:
                candidates = sorted(p for p in available if "usbmodem" in p or "usbserial" in p)
                if len(candidates) != 1:
                    print(f"Serial port missing: {serial_path}; retrying...", file=sys.stderr)
                    time.sleep(2)
                    continue
                selected = candidates[0]
                serial_path = selected
                print(f"Arduino port changed to {selected}", file=sys.stderr)
            with serial.Serial(selected, SERIAL_BAUD, timeout=1) as port:
                print(f"Connected to {selected} at {SERIAL_BAUD} baud", file=sys.stderr)
                time.sleep(2)  # Arduino may reset when serial opens.
                while True:
                    raw = port.readline().decode("utf-8", errors="replace").strip()
                    if raw:
                        yield raw
        except (serial.SerialException, OSError) as exc:
            print(f"Serial disconnected: {exc}; reconnecting...", file=sys.stderr)
            time.sleep(2)


def post(seq: int, reading: dict[str, Any]) -> None:
    payload = {"deviceId": DEVICE_ID, "seq": seq, "readings": [reading]}
    req = urllib.request.Request(
        INGEST_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {DEVICE_TOKEN}"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=5) as response:
        if response.status != 202:
            raise RuntimeError(f"Unexpected HTTP {response.status}")
        response.read()


def report_error(exc: Exception) -> None:
    if isinstance(exc, urllib.error.HTTPError):
        print(f"POST HTTP {exc.code}: {exc.read().decode('utf-8', 'replace')}", file=sys.stderr)
    else:
        print(f"POST error: {exc}", file=sys.stderr)


def main() -> None:
    print(f"Forwarding {DEVICE_ID} to {INGEST_URL} once per Arduino BPM reading", file=sys.stderr)
    print("After calibration: range recalculated from each rolling mean +/- std", file=sys.stderr)
    if DEMO_STUB_VITALS:
        print("DEMO: skinTempC=33.4 and SpO2=98 are NOT measured", file=sys.stderr)

    state = BpmRange()
    seq = 0
    pending: tuple[int, dict[str, Any]] | None = None

    try:
        for raw in lines():
            sample = parse_bpm(raw)
            if sample is None:
                continue

            # Exactly one computation and one new POST per Arduino BPM output.
            # The first 7 samples establish the range; every subsequent sample
            # moves the 5-reading sliding window and recalculates mean +/- std.
            state.add_sample(sample)
            bpm = state.current_bpm()
            reading = make_reading(bpm, state.bpm_min, state.bpm_max)

            # Retry one failed send before sending the current value. This
            # preserves sequence numbering and avoids an unlimited backlog.
            if pending is not None:
                try:
                    post(*pending)
                except (urllib.error.URLError, TimeoutError, RuntimeError) as exc:
                    if isinstance(exc, urllib.error.HTTPError) and exc.code in (401, 403):
                        pending = None
                        raise SystemExit(f"Device authentication failed (HTTP {exc.code}). Check DEVICE_TOKEN.") from exc
                    report_error(exc)
                    print("Skipped this Arduino reading while a POST is pending", file=sys.stderr)
                    continue
                print(f"Retried pending batch {pending[0]}", file=sys.stderr)
                seq += 1
                pending = None

            try:
                post(seq, reading)
            except (urllib.error.URLError, TimeoutError, RuntimeError) as exc:
                if isinstance(exc, urllib.error.HTTPError) and exc.code in (401, 403):
                    raise SystemExit(f"Device authentication failed (HTTP {exc.code}). Check DEVICE_TOKEN.") from exc
                report_error(exc)
                pending = (seq, reading)
            else:
                mode = "filtered" if state.bpm_min is not None else "calibrating"
                bpm_text = f"{bpm:.1f}" if bpm is not None else "null"
                print(
                    f"Sent {seq} ({mode}): bpm={bpm_text}, "
                    f"range=[{state.bpm_min}, {state.bpm_max}]",
                    file=sys.stderr,
                )
                seq += 1
    except KeyboardInterrupt:
        print("Stopped", file=sys.stderr)
    finally:
        if pending is not None:
            try:
                post(*pending)
                print(f"Sent pending batch {pending[0]}", file=sys.stderr)
            except (urllib.error.URLError, TimeoutError, RuntimeError) as exc:
                report_error(exc)


if __name__ == "__main__":
    main()
