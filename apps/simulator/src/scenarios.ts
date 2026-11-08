export type ScenarioName = "stable" | "tachycardia" | "fall" | "dropout" | "skin_rise" | "irregular";

export type SimReading = {
  ts: number;
  bpm: number | null;
  ibiMs: number[];
  signalQuality: number;
  activity: "rest" | "light" | "active";
  motionMag: number;
  fallDetected: boolean;
  skinTempC: number | null;
  spo2: number | null;
  spo2Simulated: true;
};

// Small, deterministic fluctuations so demo cards visibly update while avoiding
// a new random jump on each render. Not measured physiological data.
function bpmVariation(second: number): number {
  return Math.round(2.5 * Math.sin(second * 0.73) + 1.5 * Math.sin(second * 0.31 + 0.8));
}

export function sample(scenario: ScenarioName, second: number, startTs: number): SimReading {
  const ts = startTs + second * 1000;
  const base: SimReading = {
    ts,
    bpm: 70 + bpmVariation(second),
    ibiMs: [850],
    signalQuality: 0.96,
    activity: "rest",
    motionMag: 0.04,
    fallDetected: false,
    skinTempC: 33.4,
    spo2: 98,
    spo2Simulated: true,
  };
  if (scenario === "tachycardia") {
    base.bpm = Math.max(30, Math.min(142, Math.round(Math.min(138, 72 + second * 0.35) + bpmVariation(second))));
  } else if (scenario === "fall") {
    if (second === 45) {
      base.fallDetected = true;
      base.motionMag = 3.2;
      base.activity = "active";
    }
  } else if (scenario === "dropout") {
    if (second >= 40 && second < 70) {
      base.bpm = null;
      base.signalQuality = 0.05;
      base.spo2 = null;
    }
  } else if (scenario === "skin_rise") {
    base.skinTempC = second < 430 ? 33.2 : 34.6;
  } else if (scenario === "irregular") {
    base.bpm = 78 + bpmVariation(second);
    base.ibiMs = second % 2 === 0 ? [420] : [1080];
  }
  return base;
}
