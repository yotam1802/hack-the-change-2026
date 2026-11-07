import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";

let server: Server;
let base: string;

beforeAll(async () => {
  process.env.PGLITE_PATH = "memory";
  process.env.ROLE = "all";
  process.env.LOG_LEVEL = "silent";
  const { boot } = await import("./index.js");
  const started = await boot(0);
  server = started.server;
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("no port");
  base = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

function reading(ts: number, bpm: number, extra: Record<string, unknown> = {}) {
  return {
    ts,
    bpm,
    ibiMs: [830],
    signalQuality: 0.95,
    activity: "rest",
    motionMag: 0.04,
    fallDetected: false,
    skinTempC: 33.4,
    spo2: 98,
    spo2Simulated: true,
    ...extra,
  };
}

describe("enrollment and monitoring", () => {
  it("pairs a device, learns a baseline, flags a fall once, and lets a nurse unpair", async () => {
    const enrolled = await fetch(`${base}/api/enrollments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: "Alex Rivera",
        ctas: 3,
        enrollmentReason: "chest_pain",
        deviceId: "device-01",
        nurseId: "n-1",
        vitals: { tempC: 36.7, tempMethod: "oral", sbp: 128, dbp: 78, respRate: 16, pain: 3 },
      }),
    });
    expect(enrolled.status).toBe(201);
    const body = await enrolled.json();
    const token = body.deviceToken as string;
    const patientId = body.patient.publicCode as string;
    expect(body.patient.ctas).toBe(3);
    const id = body.patient.id as string;
    const start = Date.now();
    const readings = Array.from({ length: 90 }, (_, i) => reading(start + i * 1000, 72));
    const posted = await fetch(`${base}/api/readings`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ deviceId: "device-01", seq: 1, readings }),
    });
    expect(posted.status).toBe(202);
    await new Promise((resolve) => setTimeout(resolve, 400));
    const board = await (await fetch(`${base}/api/board`)).json();
    const patient = board.patients.find((item: { id: string }) => item.id === id);
    expect(patient.hrBaseline.status).toBe("set");
    expect(patient.hrBaseline.bpm).toBe(72);

    const fall = await fetch(`${base}/api/readings`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        deviceId: "device-01",
        seq: 2,
        readings: [reading(start + 95_000, 74, { fallDetected: true })],
      }),
    });
    expect(fall.status).toBe(202);
    await fetch(`${base}/api/readings`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({
        deviceId: "device-01",
        seq: 2,
        readings: [reading(start + 95_000, 74, { fallDetected: true })],
      }),
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const after = await (await fetch(`${base}/api/patients/${id}`)).json();
    const falls = after.patient.openPrompts.filter((prompt: { kind: string }) => prompt.kind === "fall");
    expect(falls).toHaveLength(1);

    const action = await fetch(`${base}/api/patients/${id}/actions`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-nurse-id": "n-1" },
      body: JSON.stringify({
        nurseId: "n-1",
        action: "call_to_treatment",
        vitals: { tempC: 38.4, tempMethod: "tympanic" },
      }),
    });
    expect(action.status).toBe(200);
    const gone = await (await fetch(`${base}/api/board`)).json();
    expect(gone.patients.some((item: { id: string }) => item.id === id)).toBe(false);

    const report = await fetch(`${base}/api/public/patients/${patientId}`);
    expect(report.status).toBe(200);
    const publicView = await report.json();
    expect(publicView.monitored).toBe(false);
  });
});
