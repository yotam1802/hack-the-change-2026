import http from "k6/http";
import { check } from "k6";

// Point this at a paired device. The node simulator (npm run load) enrolls
// 2,000 patients itself; this script is the same ingest shape for k6.
export const options = {
  vus: 50,
  duration: "20s",
  thresholds: {
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<1000"],
  },
};

const url = __ENV.INGEST_URL || "http://127.0.0.1:8787/api/readings";
const token = __ENV.DEVICE_TOKEN || "dev-device-02";
const deviceId = __ENV.DEVICE_ID || "device-02";

export default function () {
  const now = Date.now();
  const readings = [];
  for (let i = 0; i < 5; i++) {
    readings.push({
      ts: now - (4 - i) * 1000,
      bpm: 72,
      ibiMs: [830],
      signalQuality: 0.95,
      activity: "rest",
      motionMag: 0.04,
      fallDetected: false,
      skinTempC: 33.4,
      spo2: 98,
      spo2Simulated: true,
    });
  }
  const res = http.post(url, JSON.stringify({ deviceId, seq: Math.floor(now / 1000), readings }), {
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  });
  check(res, { "accepted": (r) => r.status === 202 || r.status === 409 });
}
