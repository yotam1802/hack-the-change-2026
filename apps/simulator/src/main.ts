import { sample, type ScenarioName } from "./scenarios.js";

const baseUrl = process.env.INGEST_URL ?? "http://127.0.0.1:8787";

const DEMOS: Array<{ name: string; scenario: ScenarioName; ctas: 1 | 2 | 3 | 4 | 5; reason: "chest_pain" | "abnormal_labs" | "sob" | "other"; deviceId: string; speed: number }> = [
  { name: "Sam Okonkwo", scenario: "stable", ctas: 4, reason: "other", deviceId: "device-02", speed: 8 },
  { name: "Riley Chen", scenario: "tachycardia", ctas: 3, reason: "chest_pain", deviceId: "device-03", speed: 12 },
  { name: "Jordan Hale", scenario: "fall", ctas: 2, reason: "sob", deviceId: "device-04", speed: 10 },
  { name: "Avery Singh", scenario: "dropout", ctas: 3, reason: "chest_pain", deviceId: "device-05", speed: 10 },
  { name: "Morgan Blake", scenario: "skin_rise", ctas: 3, reason: "abnormal_labs", deviceId: "device-06", speed: 40 },
  { name: "Casey Nguyen", scenario: "irregular", ctas: 2, reason: "abnormal_labs", deviceId: "device-07", speed: 8 },
];

async function waitForHealth() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.ok) return;
    } catch {
      /* server still starting */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Server did not answer at ${baseUrl}`);
}

async function enroll(demo: (typeof DEMOS)[number]) {
  const res = await fetch(`${baseUrl}/api/enrollments`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-nurse-id": "sim" },
    body: JSON.stringify({
      displayName: demo.name,
      ctas: demo.ctas,
      enrollmentReason: demo.reason,
      deviceId: demo.deviceId,
      nurseId: "sim",
      roomTempC: 22,
    }),
  });
  if (res.status === 409) {
    const devices = await (await fetch(`${baseUrl}/api/devices`)).json();
    const existing = devices.devices.find((device: { id: string }) => device.id === demo.deviceId);
    return existing?.token as string;
  }
  if (!res.ok) throw new Error(await res.text());
  const body = await res.json();
  return body.deviceToken as string;
}

// The local database remembers each device's previous sequence across restarts.
// Use a time-based initial sequence for demo devices so a restarted simulator
// doesn't silently get its readings rejected as old batches. SQL `seq` is int32.
function initialDemoSequence(): number {
  return Math.floor((Date.now() - Date.UTC(2020, 0, 1)) / 1000) + 60;
}

function runPatient(demo: (typeof DEMOS)[number], token: string) {
  let activeToken = token;
  let second = 0;
  let seq = initialDemoSequence();
  let sending = false;
  const started = Date.now();

  // One request per patient per real second. Preserve every accelerated sample
  // inside the batch, including the one-off fall event and dropout intervals.
  // This also avoids the multiple overlapping requests per second that could
  // arrive out of order and be rejected as stale sequences.
  const timer = setInterval(() => {
    if (sending) return;
    const readings = Array.from({ length: demo.speed }, () => sample(demo.scenario, second++, started));
    const current = seq++;
    sending = true;
    void (async () => {
      try {
        const response = await fetch(`${baseUrl}/api/readings`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${activeToken}` },
          body: JSON.stringify({ deviceId: demo.deviceId, seq: current, readings }),
        });
        if (response.status === 401 || response.status === 409) {
          // A restarted local server can replace the in-memory device registry.
          // Re-enroll/refresh this simulator's own device before the next tick.
          console.warn(`Demo device ${demo.deviceId}: HTTP ${response.status}; refreshing enrollment`);
          const refreshed = await enroll(demo);
          if (!refreshed) throw new Error(`No token for demo device ${demo.deviceId}`);
          activeToken = refreshed;
        } else if (!response.ok) {
          console.warn(`Demo ingest failed for ${demo.deviceId}: HTTP ${response.status}`);
        }
      } catch (error) {
        console.warn(`Demo ingest failed for ${demo.deviceId}:`, error);
      } finally {
        sending = false;
      }
    })();
  }, 1000);
  return timer;
}

async function demo() {
  await waitForHealth();
  console.log("simulator streaming six scripted patients");
  for (const item of DEMOS) {
    const token = await enroll(item);
    runPatient(item, token);
  }
}

async function load() {
  const patients = Number(process.argv.find((arg) => arg.startsWith("--patients="))?.split("=")[1] ?? 2000);
  const seconds = Number(process.argv.find((arg) => arg.startsWith("--seconds="))?.split("=")[1] ?? 12);
  await waitForHealth();
  console.log(`enrolling ${patients} patients`);
  const enrolled: Array<{ id: string; token: string; seq: number; second: number; started: number }> = [];
  let cursor = 0;
  async function one(index: number) {
    const id = `swarm-${index}`;
    const created = await fetch(`${baseUrl}/api/devices`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-nurse-id": "sim" },
      body: JSON.stringify({ id }),
    });
    if (!created.ok && created.status !== 201) {
      const text = await created.text();
      if (!text.includes("already")) throw new Error(text);
    }
    const device = created.ok ? await created.json() : { token: `dev-${id}` };
    const enrollRes = await fetch(`${baseUrl}/api/enrollments`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        displayName: `Sim ${index}`,
        ctas: ((index % 5) + 1) as 1 | 2 | 3 | 4 | 5,
        enrollmentReason: index % 3 === 0 ? "chest_pain" : "other",
        deviceId: id,
        nurseId: "sim",
      }),
    });
    if (enrollRes.status === 409) return;
    if (!enrollRes.ok) throw new Error(await enrollRes.text());
    enrolled.push({ id, token: device.token, seq: 0, second: 0, started: Date.now() });
  }
  async function pool(total: number) {
    const workers = Array.from({ length: 40 }, async () => {
      for (;;) {
        const index = cursor++;
        if (index >= total) return;
        await one(index);
      }
    });
    await Promise.all(workers);
  }
  await pool(patients);
  if (enrolled.length === 0) throw new Error("No patients enrolled. Is the server already full of swarm devices?");
  console.log(`streaming ${enrolled.length} patients for ${seconds}s`);
  const started = Date.now();
  let inflight = 0;
  let errors = 0;
  const timer = setInterval(() => {
    const slice = Math.max(1, Math.ceil(enrolled.length / 50));
    for (let n = 0; n < slice; n++) {
      const patient = enrolled[(cursor + n) % enrolled.length];
      if (!patient || inflight > 300) continue;
      const readings = [];
      for (let s = 0; s < 5; s++) {
        const scenario: ScenarioName = Number(patient.id.slice(6)) % 10 === 0 ? "tachycardia" : "stable";
        readings.push(sample(scenario, patient.second++, patient.started));
      }
      const seq = patient.seq++;
      if (seq === 0 && Number(patient.id.slice(6)) % 25 === 0) readings[4].fallDetected = true;
      inflight += 1;
      void fetch(`${baseUrl}/api/readings`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${patient.token}` },
        body: JSON.stringify({ deviceId: patient.id, seq, readings }),
      })
        .then((res) => {
          if (!res.ok) errors += 1;
        })
        .catch(() => {
          errors += 1;
        })
        .finally(() => {
          inflight -= 1;
        });
    }
    cursor += slice;
  }, 100);

  const depths: number[] = [];
  const watcher = setInterval(async () => {
    const elapsed = (Date.now() - started) / 1000;
    if (elapsed > 4 && elapsed < 5.5) {
      await fetch(`${baseUrl}/api/system/workers`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ count: 4 }),
      });
    }
    const system = await (await fetch(`${baseUrl}/api/system`)).json();
    depths.push(system.local.busDepth);
    console.log(JSON.stringify(system.local));
  }, 1000);

  await new Promise((resolve) => setTimeout(resolve, seconds * 1000));
  clearInterval(timer);
  clearInterval(watcher);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const system = await (await fetch(`${baseUrl}/api/system`)).json();
  console.log("final", JSON.stringify({ ...system.local, errors, depthSamples: depths }));
  if (errors > enrolled.length) process.exitCode = 1;
}

const command = process.argv[2] === "load" ? load : demo;
command().catch((err) => {
  console.error(err);
  process.exit(1);
});
