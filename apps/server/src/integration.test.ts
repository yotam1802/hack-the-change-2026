import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import WebSocket from "ws";

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

    const socket = new WebSocket(base.replace("http", "ws") + "/ws");
    const live: Array<{ type: string; latest?: { bpm: number | null; bpmMin?: number | null; bpmMax?: number | null } }> = [];
    await new Promise<void>((resolve, reject) => {
      socket.on("open", () => resolve());
      socket.on("error", reject);
    });
    socket.on("message", (raw) => {
      live.push(JSON.parse(String(raw)));
    });
    socket.send(JSON.stringify({ type: "subscribe", unitId: "ed-waiting" }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    const watched = await fetch(`${base}/api/enrollments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: "Sam Okonkwo",
        ctas: 4,
        enrollmentReason: "other",
        deviceId: "device-02",
        nurseId: "n-1",
      }),
    });
    expect(watched.status).toBe(201);
    const watchBody = await watched.json();
    const watchToken = watchBody.deviceToken as string;
    async function postBpm(seq: number, bpm: number, ts: number, extra: Record<string, unknown> = {}) {
      const res = await fetch(`${base}/api/readings`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${watchToken}` },
        body: JSON.stringify({ deviceId: "device-02", seq, readings: [reading(ts, bpm, extra)] }),
      });
      expect(res.status).toBe(202);
    }
    await postBpm(1, 72, start + 200_000);
    await postBpm(2, 72, start + 201_000);
    await postBpm(3, 88, start + 202_000);
    // Same BPM but a new range must still reach the Ward via WebSocket.
    await postBpm(4, 88, start + 203_000, { bpmMin: 81, bpmMax: 91 });
    await new Promise((resolve) => setTimeout(resolve, 400));
    const rangedBoard = await (await fetch(`${base}/api/board`)).json();
    const rangedPatient = rangedBoard.patients.find((item: { id: string }) => item.id === watchBody.patient.id);
    expect(rangedPatient.latest).toMatchObject({ bpm: 88, bpmMin: 81, bpmMax: 91 });
    socket.close();
    const bpms = live.filter((event) => event.type === "heart_rate").map((event) => event.latest?.bpm);
    expect(bpms).toEqual([72, 88, 88]);
    expect(live.some((event) => event.type === "heart_rate" && event.latest?.bpmMin === 81 && event.latest?.bpmMax === 91)).toBe(true);

    const report = await fetch(`${base}/api/public/patients/${patientId}`);
    expect(report.status).toBe(200);
    const publicView = await report.json();
    expect(publicView.monitored).toBe(false);
  });
});
