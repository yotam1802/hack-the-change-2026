import { randomUUID } from "node:crypto";
import express, { type NextFunction, type Request, type Response } from "express";
import cors from "cors";
import { ZodError } from "zod";
import {
  CTAS_REASSESS_MS,
  enrollSchema,
  nurseActionSchema,
  patientReportSchema,
  readingBatchSchema,
  surveySchema,
  type Ctas,
  type GeminiJob,
} from "@waitwatch/shared";
import type { Db } from "../db/db.js";
import {
  ackOpenPrompts,
  board,
  callToTreatment,
  createJob,
  createPatient,
  deviceByToken,
  duePatients,
  ensureDevice,
  getJob,
  getPatient,
  getPatientByCode,
  insertAudit,
  insertPrompt,
  insertSurvey,
  insertVitals,
  listDevices,
  markReassessed,
  openPromptRows,
  qi,
  saveRuntimeColumns,
  setCtas,
  timeline,
  toView,
} from "../db/repo.js";
import type { MemoryBus } from "../bus/memory.js";
import type { Metrics } from "../metrics.js";
import { readCloudWatch } from "../metrics.js";
import type { Realtime } from "../realtime/hub.js";
import { initialState, resetHrBaseline, type RuntimeState } from "../rules/engine.js";
import { parseRuntime } from "../db/repo.js";
import type { StateStore } from "../state/store.js";
import { log } from "../log.js";
import { requireNurse, verifiedNurse } from "../auth/nurse.js";

export type HttpDeps = {
  db: Db;
  bus: MemoryBus;
  state: StateStore;
  rt: Realtime;
  metrics: Metrics;
  mode: string;
};

function asyncRoute(fn: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res).catch(next);
  };
}

function nurse(req: Request) {
  return verifiedNurse(req);
}

export function createApp(deps: HttpDeps) {
  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));
  // Public endpoints and device ingestion are exempt inside this middleware.
  app.use("/api", requireNurse);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, role: process.env.ROLE ?? "all", mode: deps.mode });
  });

  app.post(
    "/api/readings",
    asyncRoute(async (req, res) => {
      const started = Date.now();
      const token = (req.header("authorization") ?? "").replace(/^Bearer\s+/i, "");
      const device = await deviceByToken(deps.db, token);
      if (!device) {
        res.status(401).json({ error: "Unknown device token" });
        return;
      }
      if (!device.patient_id) {
        res.status(409).json({ error: "Device is not paired with a patient" });
        return;
      }
      const body = readingBatchSchema.parse(req.body);
      if (body.deviceId !== device.id) {
        res.status(403).json({ error: "Token does not match deviceId" });
        return;
      }
      deps.bus.publishReading({ ...body, patientId: device.patient_id, receivedAt: Date.now() });
      deps.metrics.noteIngest(Date.now() - started, body.readings.length);
      res.status(202).json({ ok: true });
    }),
  );

  app.get("/api/devices", asyncRoute(async (_req, res) => {
    res.json({ devices: await listDevices(deps.db) });
  }));

  app.post("/api/devices", asyncRoute(async (req, res) => {
    if (!nurse(req)) {
      res.status(401).json({ error: "Nurse id required" });
      return;
    }
    const id = String(req.body?.id ?? "");
    if (!id) {
      res.status(400).json({ error: "id required" });
      return;
    }
    const device = await ensureDevice(deps.db, id);
    res.status(201).json({ id: device.id, token: device.token, paired: Boolean(device.patient_id) });
  }));

  app.post("/api/enrollments", asyncRoute(async (req, res) => {
    const input = enrollSchema.parse(req.body);
    input.nurseId = nurse(req);
    const device = await ensureDevice(deps.db, input.deviceId);
    if (device.patient_id) {
      res.status(409).json({ error: "That wearable is already paired" });
      return;
    }
    const now = Date.now();
    const patient = await createPatient(deps.db, {
      displayName: input.displayName,
      ctas: input.ctas,
      enrollmentReason: input.enrollmentReason,
      deviceId: input.deviceId,
      hospitalId: input.hospitalId,
      unitId: input.unitId,
      roomTempC: input.roomTempC ?? null,
      now,
      nextReassessAt: now + CTAS_REASSESS_MS[input.ctas],
    });
    if (!patient) throw new Error("enroll failed");
    await insertAudit(deps.db, patient.id, input.nurseId, "enrolled", now, null, {
      ctas: input.ctas,
      reason: input.enrollmentReason,
      deviceId: input.deviceId,
      complaint: input.complaint ?? null,
      symptomOnset: input.symptomOnset ?? null,
    });
    if (input.vitals) await recordVitals(deps, patient.id, patient.unit_id, input.nurseId, input.vitals);
    res.status(201).json({ patient: toView(patient, []), deviceToken: device.token });
  }));

  app.get("/api/board", asyncRoute(async (req, res) => {
    const unitId = String(req.query.unitId ?? "ed-waiting");
    res.json({ patients: await board(deps.db, unitId), serverTime: Date.now() });
  }));

  app.get("/api/patients/:id", asyncRoute(async (req, res) => {
    const patient = await getPatient(deps.db, req.params.id);
    if (!patient) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({ patient: toView(patient, await openPromptRows(deps.db, patient.id)) });
  }));

  app.get("/api/patients/:id/timeline", asyncRoute(async (req, res) => {
    const patient = await getPatient(deps.db, req.params.id);
    if (!patient) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({ patient: toView(patient, await openPromptRows(deps.db, patient.id)), ...(await timeline(deps.db, patient.id)) });
  }));

  app.post("/api/patients/:id/actions", asyncRoute(async (req, res) => {
    const action = nurseActionSchema.parse(req.body);
    action.nurseId = nurse(req);
    const patient = await getPatient(deps.db, req.params.id);
    if (!patient) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const now = Date.now();
    const onTime = now <= Number(patient.next_reassess_at);
    if (action.vitals) await recordVitals(deps, patient.id, patient.unit_id, action.nurseId, action.vitals);
    if (action.action === "reassessed_no_change" || action.action === "retriage") {
      const ctas = (action.action === "retriage" ? action.ctas : Number(patient.ctas)) as Ctas;
      if (action.action === "retriage" && !action.ctas) {
        res.status(400).json({ error: "Re-triage needs a CTAS level" });
        return;
      }
      const next = now + CTAS_REASSESS_MS[ctas];
      if (action.action === "retriage") await setCtas(deps.db, patient.id, ctas, next);
      else await markReassessed(deps.db, patient.id, next);
      await ackOpenPrompts(deps.db, patient.id, action.nurseId, now);
      await insertAudit(deps.db, patient.id, action.nurseId, action.action, now, onTime, { ctas, note: action.note ?? null });
      const job: GeminiJob = { id: randomUUID(), type: "reassessment_note", patientId: patient.id };
      await createJob(deps.db, job.id, job.type, job);
      deps.bus.publishJob(job);
    } else if (action.action === "call_to_treatment") {
      await callToTreatment(deps.db, patient.id);
      await ackOpenPrompts(deps.db, patient.id, action.nurseId, now);
      await insertAudit(deps.db, patient.id, action.nurseId, action.action, now, onTime, { note: action.note ?? null });
    } else if (action.action === "reset_baseline") {
      await deps.state.update(patient.id, async (prev) => {
        const base = prev ?? parseRuntime(patient.runtime) ?? initialState(patient.id, Number(patient.paired_at), patient.room_temp_c);
        const next = resetHrBaseline(structuredClone(base) as RuntimeState, now);
        await saveRuntimeColumns(deps.db, next);
        return { state: next, result: true };
      });
      await insertAudit(deps.db, patient.id, action.nurseId, action.action, now, null, { note: action.note ?? null });
    } else {
      await insertAudit(deps.db, patient.id, action.nurseId, action.action, now, null, { note: action.note ?? null });
    }
    const updated = await getPatient(deps.db, patient.id);
    res.json({ patient: updated ? toView(updated, await openPromptRows(deps.db, updated.id)) : null });
  }));

  app.post("/api/patients/:id/jobs", asyncRoute(async (req, res) => {
    const type = req.body?.type;
    if (type !== "reassessment_note" && type !== "retrospective" && type !== "explain_prompt") {
      res.status(400).json({ error: "Unknown job type" });
      return;
    }
    const patient = await getPatient(deps.db, req.params.id);
    if (!patient) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    const job: GeminiJob = { id: randomUUID(), type, patientId: patient.id, promptId: req.body?.promptId };
    await createJob(deps.db, job.id, job.type, job);
    deps.bus.publishJob(job);
    res.status(202).json({ jobId: job.id });
  }));

  app.post("/api/units/:unitId/handoff", asyncRoute(async (req, res) => {
    const job: GeminiJob = { id: randomUUID(), type: "handoff", unitId: req.params.unitId };
    await createJob(deps.db, job.id, job.type, job);
    deps.bus.publishJob(job);
    res.status(202).json({ jobId: job.id });
  }));

  app.get("/api/jobs/:id", asyncRoute(async (req, res) => {
    const job = await getJob(deps.db, req.params.id);
    if (!job) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json({ id: job.id, status: job.status, result: job.result, type: job.type });
  }));

  app.get("/api/public/patients/:code", asyncRoute(async (req, res) => {
    const patient = await getPatientByCode(deps.db, req.params.code.toUpperCase());
    if (!patient) {
      res.status(404).json({ error: "Code not found" });
      return;
    }
    res.json({
      monitored: patient.status === "waiting",
      displayName: patient.display_name,
      message: "You are being monitored. A nurse can see your heart rate and can reassess you if it changes.",
    });
  }));

  app.post("/api/public/reports", asyncRoute(async (req, res) => {
    const body = patientReportSchema.parse(req.body);
    const patient = await getPatientByCode(deps.db, body.code.toUpperCase());
    if (!patient || patient.status !== "waiting") {
      res.status(404).json({ error: "Code not found" });
      return;
    }
    const now = Date.now();
    if (body.pain != null) {
      await insertVitals(deps.db, patient.id, "patient", now, { pain: body.pain });
      const prompt = await insertPrompt(deps.db, patient.id, {
        kind: "pain_report",
        severity: "info",
        message: `Patient reported pain ${body.pain}/10.`,
      }, now, null);
      if (prompt) await deps.rt.push(patient.unit_id, { type: "prompt", prompt });
    }
    if (body.feelWorse) {
      const prompt = await insertPrompt(deps.db, patient.id, {
        kind: "patient_feels_worse",
        severity: "warning",
        message: "Patient says they feel worse.",
      }, now, null);
      if (prompt) await deps.rt.push(patient.unit_id, { type: "prompt", prompt });
    }
    await insertAudit(deps.db, patient.id, "patient", "patient_report", now, null, body);
    res.json({ ok: true });
  }));

  app.post("/api/surveys", asyncRoute(async (req, res) => {
    const body = surveySchema.parse(req.body);
    await insertSurvey(deps.db, body.role, body.score, body.comment);
    res.status(201).json({ ok: true });
  }));

  app.get("/api/qi", asyncRoute(async (req, res) => {
    res.json(await qi(deps.db, String(req.query.unitId ?? "ed-waiting")));
  }));

  app.get("/api/system", asyncRoute(async (_req, res) => {
    const local = deps.metrics.snapshot({ busDepth: deps.bus.depth(), workers: deps.bus.workers, mode: deps.mode });
    const cloudwatch = await readCloudWatch().catch(() => null);
    res.json({ local, cloudwatch });
  }));

  app.post("/api/system/workers", asyncRoute(async (req, res) => {
    const count = Number(req.body?.count);
    if (!Number.isFinite(count)) {
      res.status(400).json({ error: "count required" });
      return;
    }
    deps.bus.setConcurrency(count);
    res.json({ workers: deps.bus.workers });
  }));

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({
        error: err.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      });
      return;
    }
    log.error({ err }, "request failed");
    res.status(500).json({ error: "internal" });
  });

  return app;
}

async function recordVitals(
  deps: HttpDeps,
  patientId: string,
  unitId: string,
  nurseId: string,
  vitals: { tempC?: number; tempMethod?: "oral" | "tympanic" | "temporal"; sbp?: number; dbp?: number; respRate?: number; pain?: number },
) {
  const now = Date.now();
  await insertVitals(deps.db, patientId, nurseId, now, vitals);
  if (vitals.tempC != null && vitals.tempC >= 38) {
    const prompt = await insertPrompt(deps.db, patientId, {
      kind: "fever_recorded",
      severity: "warning",
      message: `Official temperature ${vitals.tempC.toFixed(1)}°C is at or above 38.0°C. Fever is recorded from the nurse's measurement, not the skin sensor.`,
    }, now, null);
    if (prompt) await deps.rt.push(unitId, { type: "prompt", prompt });
  }
}

export function startDueSweep(deps: HttpDeps) {
  const timer = setInterval(() => {
    duePatients(deps.db, Date.now())
      .then(async (found) => {
        for (const row of found.rows) {
          const prompt = await insertPrompt(deps.db, row.id, {
            kind: "reassessment_due",
            severity: "info",
            message: "CTAS reassessment interval has elapsed.",
          }, Date.now(), null);
          if (prompt) await deps.rt.push(row.unit_id, { type: "prompt", prompt });
        }
      })
      .catch((err) => log.error({ err }, "reassessment sweep failed"));
  }, 10_000);
  timer.unref?.();
  return timer;
}

export function startSnapshots(deps: HttpDeps) {
  const timer = setInterval(() => {
    if (deps.rt.subscriberCount() === 0) return;
    board(deps.db, "ed-waiting")
      .then((patients) => deps.rt.push("ed-waiting", { type: "snapshot", patients, serverTime: Date.now() }))
      .catch((err) => log.error({ err }, "snapshot failed"));
  }, 2000);
  timer.unref?.();
  return timer;
}
