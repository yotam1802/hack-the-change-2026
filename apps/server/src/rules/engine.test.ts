import { describe, expect, it } from "vitest";
import type { Reading } from "@waitwatch/shared";
import {
  applyBatch,
  applyReading,
  initialState,
  resetHrBaseline,
  type RuntimeState,
} from "./engine.js";

function reading(ts: number, over: Partial<Reading> = {}): Reading {
  return {
    ts,
    bpm: 72,
    ibiMs: [830],
    signalQuality: 0.95,
    activity: "rest",
    motionMag: 0.05,
    fallDetected: false,
    skinTempC: 33.4,
    spo2: 98,
    spo2Simulated: true,
    ...over,
  };
}

function feed(state: RuntimeState, from: number, seconds: number, over: Partial<Reading> | ((i: number) => Partial<Reading>) = {}) {
  const prompts = [];
  for (let i = 0; i < seconds; i++) {
    const extra = typeof over === "function" ? over(i) : over;
    const out = applyReading(state, reading(from + i * 1000, extra));
    prompts.push(...out.prompts);
  }
  return prompts;
}

describe("heart-rate baseline", () => {
  it("sets a median baseline once 90 resting seconds are in", () => {
    const state = initialState("p", 0, 22);
    const prompts = feed(state, 0, 90);
    expect(state.hr.status).toBe("set");
    expect(state.hr.bpm).toBe(72);
    expect(prompts.some((p) => p.kind === "abnormal_arrival")).toBe(false);
  });

  it("extends past 2 minutes when the patient has not rested enough, then sets", () => {
    const state = initialState("p", 0, 22);
    feed(state, 0, 100, { activity: "active", motionMag: 1.4 });
    expect(state.hr.status).toBe("calibrating");
    feed(state, 100_000, 30, { activity: "active" });
    expect(state.hr.status).toBe("extended");
    feed(state, 130_000, 90);
    expect(state.hr.status).toBe("set");
    expect(state.hr.bpm).toBe(72);
  });

  it("gives up at 5 minutes without enough rest", () => {
    const state = initialState("p", 0, 22);
    const prompts = feed(state, 0, 301, { activity: "active", signalQuality: 0.95, bpm: 110 });
    expect(state.hr.status).toBe("insufficient");
    expect(prompts.some((p) => p.kind === "baseline_insufficient")).toBe(true);
  });

  it("flags a baseline that is already abnormal", () => {
    const state = initialState("p", 0, 22);
    const prompts = feed(state, 0, 90, { bpm: 120 });
    expect(state.hr.bpm).toBe(120);
    expect(state.hr.abnormalArrival).toBe(true);
    expect(prompts.some((p) => p.kind === "abnormal_arrival")).toBe(true);
  });

  it("starts calibration over when the nurse resets the baseline", () => {
    const state = initialState("p", 0, 22);
    feed(state, 0, 90);
    const reset = resetHrBaseline(state, 200_000);
    expect(reset.hr.status).toBe("calibrating");
    expect(reset.hr.bpm).toBeUndefined();
    feed(reset, 200_000, 90, { bpm: 64 });
    expect(reset.hr.bpm).toBe(64);
  });
});

describe("deviation and recovery", () => {
  function withBaseline(bpm = 70) {
    const state = initialState("p", 0, 22);
    feed(state, 0, 90, { bpm });
    return state;
  }

  it("warns after 30 seconds modestly away from baseline at rest", () => {
    const state = withBaseline(70);
    const prompts = feed(state, 90_000, 40, { bpm: 95 });
    expect(prompts.some((p) => p.kind === "hr_deviation_warning")).toBe(true);
    expect(prompts.some((p) => p.kind === "hr_deviation_urgent")).toBe(false);
  });

  it("raises an urgent deviation when the gap is large", () => {
    const state = withBaseline(70);
    const prompts = feed(state, 90_000, 40, { bpm: 120 });
    expect(prompts.some((p) => p.kind === "hr_deviation_urgent")).toBe(true);
  });

  it("does not flag a high rate while the patient is moving, then flags poor recovery", () => {
    const state = withBaseline(70);
    const moving = feed(state, 90_000, 60, { activity: "active", bpm: 130, motionMag: 1.2 });
    expect(moving.some((p) => p.kind.startsWith("hr_deviation"))).toBe(false);
    const back = feed(state, 150_000, 200, { activity: "rest", bpm: 120 });
    expect(back.some((p) => p.kind === "poor_recovery")).toBe(true);
  });
});

describe("safety rules during calibration", () => {
  it("flags tachycardia before a baseline exists", () => {
    const state = initialState("p", 0, 22);
    const prompts = feed(state, 0, 15, { bpm: 140 });
    expect(prompts.some((p) => p.kind === "safety_tachy")).toBe(true);
  });

  it("flags bradycardia", () => {
    const state = initialState("p", 0, 22);
    const prompts = feed(state, 0, 15, { bpm: 36 });
    expect(prompts.some((p) => p.kind === "safety_brady")).toBe(true);
  });

  it("flags a fall immediately", () => {
    const state = initialState("p", 0, 22);
    const { prompts } = applyReading(state, reading(1000, { fallDetected: true }));
    expect(prompts.map((p) => p.kind)).toContain("fall");
  });

  it("flags a loose sensor after 15 seconds", () => {
    const state = initialState("p", 0, 22);
    const prompts = feed(state, 0, 16, { signalQuality: 0.1, bpm: null });
    expect(prompts.some((p) => p.kind === "sensor_detached")).toBe(true);
  });

  it("flags simulated SpO2 under 92", () => {
    const state = initialState("p", 0, 22);
    const prompts = feed(state, 0, 12, { spo2: 88 });
    expect(prompts.some((p) => p.kind === "spo2_low")).toBe(true);
  });
});

describe("skin temperature", () => {
  it("ignores the warm-up, then baselines, then prompts on a 1°C rise held for 10 minutes", () => {
    const state = initialState("p", 0, 22);
    feed(state, 0, 10, { skinTempC: 25 });
    expect(state.skin.status).toBe("warming");
    expect(state.detachedSince).toBeNull();
    feed(state, 300_000, 130, { skinTempC: 33.2 });
    expect(state.skin.status).toBe("set");
    expect(state.skin.tempC).toBeCloseTo(33.2, 1);
    const prompts = feed(state, 430_000, 601, { skinTempC: 34.4 });
    expect(prompts.some((p) => p.kind === "skin_temp_rising")).toBe(true);
  });

  it("treats a room-temperature sensor as detached once warm-up has passed", () => {
    const state = initialState("p", 0, 22);
    const prompts = feed(state, 300_000, 20, { skinTempC: 22.2 });
    expect(prompts.some((p) => p.kind === "sensor_detached")).toBe(true);
  });
});

describe("rhythm hint", () => {
  it("notes irregular intervals at rest and labels them as a hint", () => {
    const state = initialState("p", 0, 22);
    const prompts = feed(state, 0, 20, (i) => ({ ibiMs: i % 2 === 0 ? [400] : [1100] }));
    const hint = prompts.find((p) => p.kind === "irregular_rhythm");
    expect(hint?.severity).toBe("info");
    expect(hint?.message).toMatch(/not a rhythm diagnosis/i);
  });
});

describe("batch idempotency", () => {
  it("ignores a retried sequence number", () => {
    const state = initialState("p", 0, 22);
    const readings = [reading(0, { fallDetected: true })];
    const first = applyBatch(state, { seq: 1, readings });
    expect(first.duplicate).toBe(false);
    expect(first.prompts.some((p) => p.kind === "fall")).toBe(true);
    const second = applyBatch(state, { seq: 1, readings });
    expect(second.duplicate).toBe(true);
    expect(second.prompts).toHaveLength(0);
  });
});
