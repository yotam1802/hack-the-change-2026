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

export function sample(scenario: ScenarioName, second: number, startTs: number): SimReading {
  const ts = startTs + second * 1000;
  const base: SimReading = {
    ts,
    bpm: 70 + Math.round(Math.sin(second / 8) * 2),
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
    base.bpm = Math.min(142, Math.round(72 + second * 0.35));
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
    base.bpm = 78;
    base.ibiMs = second % 2 === 0 ? [420] : [1080];
  }
  return base;
}
