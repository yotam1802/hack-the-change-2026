import type { Reading, Severity } from "@waitwatch/shared";

export const HR_MIN_SAMPLES = 90;
export const HR_CALIBRATE_MS = 120_000;
export const HR_EXTEND_MS = 300_000;
export const DEVIATION_HOLD_MS = 30_000;
export const SAFETY_HOLD_MS = 10_000;
export const DETACH_MS = 15_000;
export const RECOVERY_MS = 180_000;
export const SKIN_WARM_MS = 300_000;
export const SKIN_CAL_MS = 120_000;
export const SKIN_TREND_MS = 600_000;
export const RHYTHM_RMSSD_MS = 120;

export type PromptDraft = {
  kind: string;
  severity: Severity;
  message: string;
};

export type HrBaseline = {
  status: "calibrating" | "extended" | "set" | "insufficient";
  startedAt: number;
  validBpms: number[];
  bpm?: number;
  spread?: number;
  capturedAt?: number;
  abnormalArrival?: boolean;
};

export type SkinBaseline = {
  status: "warming" | "calibrating" | "set";
  pairedAt: number;
  calibStartedAt?: number;
  samples: number[];
  tempC?: number;
  aboveSince?: number | null;
};

export type RuntimeState = {
  patientId: string;
  lastSeq: number;
  version: number;
  roomTempC: number | null;
  hr: HrBaseline;
  skin: SkinBaseline;
  deviationSince: number | null;
  recoveryDeadline: number | null;
  wasNonRest: boolean;
  detachedSince: number | null;
  tachySince: number | null;
  bradySince: number | null;
  spo2Since: number | null;
  recentIbi: number[];
  cooldownUntil: Record<string, number>;
};

export function initialState(
  patientId: string,
  pairedAt: number,
  roomTempC: number | null,
): RuntimeState {
  return {
    patientId,
    lastSeq: -1,
    version: 0,
    roomTempC,
    hr: { status: "calibrating", startedAt: pairedAt, validBpms: [] },
    skin: { status: "warming", pairedAt, samples: [], aboveSince: null },
    deviationSince: null,
    recoveryDeadline: null,
    wasNonRest: false,
    detachedSince: null,
    tachySince: null,
    bradySince: null,
    spo2Since: null,
    recentIbi: [],
    cooldownUntil: {},
  };
}

export function resetHrBaseline(state: RuntimeState, at: number): RuntimeState {
  return {
    ...state,
    version: state.version + 1,
    hr: { status: "calibrating", startedAt: at, validBpms: [] },
    deviationSince: null,
    recoveryDeadline: null,
    wasNonRest: false,
  };
}

export function warnThreshold(baseline: number): number {
  return Math.max(20, baseline * 0.2);
}

export function urgentThreshold(baseline: number): number {
  return Math.max(35, baseline * 0.35);
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  if (s.length % 2 === 1) return s[mid];
  return (s[mid - 1] + s[mid]) / 2;
}

function iqr(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const at = (p: number) => {
    const i = (s.length - 1) * p;
    const lo = Math.floor(i);
    const hi = Math.ceil(i);
    if (lo === hi) return s[lo];
    return s[lo] + (s[hi] - s[lo]) * (i - lo);
  };
  return at(0.75) - at(0.25);
}

function pushPrompt(
  state: RuntimeState,
  prompts: PromptDraft[],
  key: string,
  ts: number,
  cooldownMs: number,
  draft: PromptDraft,
) {
  if (ts < (state.cooldownUntil[key] ?? 0)) return;
  state.cooldownUntil[key] = ts + cooldownMs;
  prompts.push(draft);
}

function finishHr(state: RuntimeState, ts: number, prompts: PromptDraft[]) {
  const bpm = median(state.hr.validBpms);
  const spread = iqr(state.hr.validBpms);
  state.hr = {
    status: "set",
    startedAt: state.hr.startedAt,
    validBpms: [],
    bpm,
    spread,
    capturedAt: ts,
    abnormalArrival: bpm > 100 || bpm < 50,
  };
  if (state.hr.abnormalArrival) {
    pushPrompt(state, prompts, "abnormal_arrival", ts, 60 * 60_000, {
      kind: "abnormal_arrival",
      severity: "warning",
      message: `Resting baseline is ${Math.round(bpm)} bpm. The patient arrived already outside 50–100. Confirm before treating this as their normal.`,
    });
  }
}

function updateHrBaseline(state: RuntimeState, reading: Reading, prompts: PromptDraft[]) {
  if (state.hr.status === "set" || state.hr.status === "insufficient") return;
  const valid =
    reading.activity === "rest" &&
    reading.signalQuality >= 0.7 &&
    reading.bpm != null;
  if (valid && reading.bpm != null) state.hr.validBpms.push(reading.bpm);
  const elapsed = reading.ts - state.hr.startedAt;
  if (
    state.hr.validBpms.length >= HR_MIN_SAMPLES &&
    elapsed >= (HR_MIN_SAMPLES - 1) * 1000 &&
    elapsed <= HR_EXTEND_MS
  ) {
    finishHr(state, reading.ts, prompts);
    return;
  }
  if (state.hr.status === "calibrating" && elapsed >= HR_CALIBRATE_MS) {
    state.hr.status = "extended";
  }
  if (elapsed >= HR_EXTEND_MS) {
    state.hr.status = "insufficient";
    state.hr.validBpms = [];
    pushPrompt(state, prompts, "baseline_insufficient", reading.ts, 60 * 60_000, {
      kind: "baseline_insufficient",
      severity: "info",
      message: "Not enough resting heart-rate data to set a personal baseline. Ask the patient to rest a moment and retry.",
    });
  }
}

function updateDeviation(state: RuntimeState, reading: Reading, prompts: PromptDraft[]) {
  if (state.hr.status !== "set" || state.hr.bpm == null) return;
  const baseline = state.hr.bpm;
  const atRest = reading.activity === "rest" && reading.signalQuality >= 0.7 && reading.bpm != null;
  if (!atRest) {
    state.deviationSince = null;
    if (reading.activity !== "rest") {
      state.wasNonRest = true;
      state.recoveryDeadline = null;
    }
    return;
  }
  const bpm = reading.bpm as number;
  const delta = Math.abs(bpm - baseline);
  const warn = warnThreshold(baseline);
  const urgent = urgentThreshold(baseline);

  if (state.wasNonRest) {
    if (delta <= warn) {
      state.wasNonRest = false;
      state.recoveryDeadline = null;
    } else {
      if (state.recoveryDeadline == null) state.recoveryDeadline = reading.ts + RECOVERY_MS;
      if (reading.ts >= state.recoveryDeadline) {
        pushPrompt(state, prompts, "poor_recovery", reading.ts, 180_000, {
          kind: "poor_recovery",
          severity: "warning",
          message: `Heart rate is ${Math.round(bpm)} bpm and has not returned near the resting baseline of ${Math.round(baseline)} within 3 minutes of activity stopping.`,
        });
        state.wasNonRest = false;
        state.recoveryDeadline = null;
      }
    }
  }

  if (delta > urgent) {
    if (state.deviationSince == null) state.deviationSince = reading.ts;
    if (reading.ts - state.deviationSince >= DEVIATION_HOLD_MS) {
      pushPrompt(state, prompts, "hr_deviation_urgent", reading.ts, 60_000, {
        kind: "hr_deviation_urgent",
        severity: "urgent",
        message: `Heart rate ${Math.round(bpm)} bpm is more than ${Math.round(urgent)} away from the resting baseline of ${Math.round(baseline)}, for 30 seconds at rest.`,
      });
    }
  } else if (delta > warn) {
    if (state.deviationSince == null) state.deviationSince = reading.ts;
    if (reading.ts - state.deviationSince >= DEVIATION_HOLD_MS) {
      pushPrompt(state, prompts, "hr_deviation_warning", reading.ts, 120_000, {
        kind: "hr_deviation_warning",
        severity: "warning",
        message: `Heart rate ${Math.round(bpm)} bpm has stayed more than ${Math.round(warn)} away from the resting baseline of ${Math.round(baseline)} for 30 seconds at rest.`,
      });
    }
  } else {
    state.deviationSince = null;
  }
}

function updateSafety(state: RuntimeState, reading: Reading, prompts: PromptDraft[]) {
  const atRest = reading.activity === "rest" && reading.bpm != null && reading.signalQuality >= 0.5;
  if (atRest && (reading.bpm as number) > 130) {
    if (state.tachySince == null) state.tachySince = reading.ts;
    if (reading.ts - state.tachySince >= SAFETY_HOLD_MS) {
      pushPrompt(state, prompts, "safety_tachy", reading.ts, 60_000, {
        kind: "safety_tachy",
        severity: "urgent",
        message: `Heart rate ${Math.round(reading.bpm as number)} bpm at rest is above 130.`,
      });
    }
  } else state.tachySince = null;

  if (atRest && (reading.bpm as number) < 40) {
    if (state.bradySince == null) state.bradySince = reading.ts;
    if (reading.ts - state.bradySince >= SAFETY_HOLD_MS) {
      pushPrompt(state, prompts, "safety_brady", reading.ts, 60_000, {
        kind: "safety_brady",
        severity: "urgent",
        message: `Heart rate ${Math.round(reading.bpm as number)} bpm at rest is below 40.`,
      });
    }
  } else state.bradySince = null;

  if (reading.fallDetected) {
    pushPrompt(state, prompts, "fall", reading.ts, 120_000, {
      kind: "fall",
      severity: "urgent",
      message: "Possible fall: a free-fall then impact was detected. Check on the patient.",
    });
  }

  const pastWarmup = reading.ts - state.skin.pairedAt >= SKIN_WARM_MS;
  const skinBad =
    pastWarmup &&
    reading.skinTempC != null &&
    (reading.skinTempC < 28 ||
      (state.roomTempC != null && Math.abs(reading.skinTempC - state.roomTempC) < 1.5));
  const poorSignal = reading.signalQuality < 0.7 || reading.bpm == null;
  if (poorSignal || skinBad) {
    if (state.detachedSince == null) state.detachedSince = reading.ts;
    if (reading.ts - state.detachedSince >= DETACH_MS) {
      pushPrompt(state, prompts, "sensor_detached", reading.ts, 60_000, {
        kind: "sensor_detached",
        severity: "warning",
        message: skinBad && !poorSignal
          ? "Skin temperature suggests the wearable is not against the skin."
          : "Pulse signal has been poor for 15 seconds. The sensor may be loose.",
      });
    }
  } else state.detachedSince = null;

  if (reading.spo2 != null && reading.spo2 < 92) {
    if (state.spo2Since == null) state.spo2Since = reading.ts;
    if (reading.ts - state.spo2Since >= SAFETY_HOLD_MS) {
      pushPrompt(state, prompts, "spo2_low", reading.ts, 60_000, {
        kind: "spo2_low",
        severity: "urgent",
        message: `Simulated SpO2 is ${Math.round(reading.spo2)}%, below 92.`,
      });
    }
  } else state.spo2Since = null;
}

function updateRhythm(state: RuntimeState, reading: Reading, prompts: PromptDraft[]) {
  if (reading.activity !== "rest" || reading.signalQuality < 0.7 || reading.ibiMs.length === 0) return;
  state.recentIbi = state.recentIbi.concat(reading.ibiMs).slice(-24);
  if (state.recentIbi.length < 8) return;
  let sum = 0;
  for (let i = 1; i < state.recentIbi.length; i++) {
    const d = state.recentIbi[i] - state.recentIbi[i - 1];
    sum += d * d;
  }
  const rmssd = Math.sqrt(sum / (state.recentIbi.length - 1));
  if (rmssd >= RHYTHM_RMSSD_MS) {
    pushPrompt(state, prompts, "irregular_rhythm", reading.ts, 300_000, {
      kind: "irregular_rhythm",
      severity: "info",
      message: `Beat-to-beat intervals look irregular at rest (RMSSD ${Math.round(rmssd)} ms). This is a hint, not a rhythm diagnosis.`,
    });
  }
}

function updateSkin(state: RuntimeState, reading: Reading, prompts: PromptDraft[]) {
  if (reading.skinTempC == null) return;
  const age = reading.ts - state.skin.pairedAt;
  if (age < SKIN_WARM_MS) {
    state.skin.status = "warming";
    return;
  }
  if (state.skin.status === "warming") {
    state.skin.status = "calibrating";
    state.skin.calibStartedAt = reading.ts;
    state.skin.samples = [];
  }
  if (state.skin.status === "calibrating") {
    state.skin.samples.push(reading.skinTempC);
    const started = state.skin.calibStartedAt ?? reading.ts;
    if (reading.ts - started >= SKIN_CAL_MS && state.skin.samples.length >= 4) {
      state.skin.tempC = median(state.skin.samples);
      state.skin.samples = [];
      state.skin.status = "set";
      state.skin.aboveSince = null;
    }
    return;
  }
  if (state.skin.status === "set" && state.skin.tempC != null) {
    if (reading.skinTempC >= state.skin.tempC + 1) {
      if (state.skin.aboveSince == null) state.skin.aboveSince = reading.ts;
      if (reading.ts - state.skin.aboveSince >= SKIN_TREND_MS) {
        pushPrompt(state, prompts, "skin_temp_rising", reading.ts, 600_000, {
          kind: "skin_temp_rising",
          severity: "info",
          message: `Approximate skin temperature is ${reading.skinTempC.toFixed(1)}°C, at least 1°C above this patient's skin baseline of ${state.skin.tempC.toFixed(1)}°C for 10 minutes. Consider rechecking an official temperature.`,
        });
      }
    } else state.skin.aboveSince = null;
  }
}

export function applyReading(
  state: RuntimeState,
  reading: Reading,
): { state: RuntimeState; prompts: PromptDraft[] } {
  const prompts: PromptDraft[] = [];
  updateHrBaseline(state, reading, prompts);
  updateSkin(state, reading, prompts);
  updateDeviation(state, reading, prompts);
  updateRhythm(state, reading, prompts);
  updateSafety(state, reading, prompts);
  return { state, prompts };
}

export function applyBatch(
  state: RuntimeState,
  batch: { seq: number; readings: Reading[] },
): { state: RuntimeState; prompts: PromptDraft[]; duplicate: boolean } {
  if (batch.seq <= state.lastSeq) {
    return { state, prompts: [], duplicate: true };
  }
  const readings = [...batch.readings].sort((a, b) => a.ts - b.ts);
  const prompts: PromptDraft[] = [];
  for (const reading of readings) {
    const out = applyReading(state, reading);
    prompts.push(...out.prompts);
  }
  state.lastSeq = batch.seq;
  state.version += 1;
  return { state, prompts, duplicate: false };
}

export function hrView(hr: HrBaseline) {
  return {
    status: hr.status,
    bpm: hr.bpm,
    spread: hr.spread,
    capturedAt: hr.capturedAt,
    abnormalArrival: hr.abnormalArrival,
  };
}

export function skinView(skin: SkinBaseline) {
  return { status: skin.status, tempC: skin.tempC };
}
