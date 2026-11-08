import { randomUUID } from "node:crypto";
import type { GeminiJob, IngestEnvelope } from "@waitwatch/shared";
import type { Db } from "../db/db.js";
import { getPatient, insertPrompt, parseRuntime, persistMonitoring } from "../db/repo.js";
import { applyBatch, hrView, initialState, type RuntimeState } from "../rules/engine.js";
import type { MemoryBus } from "../bus/memory.js";
import type { Metrics } from "../metrics.js";
import type { Realtime } from "../realtime/hub.js";
import type { StateStore } from "../state/store.js";
import { log } from "../log.js";

/** Avoid redundant WebSocket events, but do notify when the range changes. */
type LastHeartRate = { bpm: number | null; bpmMin: number | null; bpmMax: number | null };
const lastPushed = new Map<string, LastHeartRate>();
const lastAiAnalysis = new Map<string, number>();

function bpmOf(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function handleEnvelope(
  deps: { db: Db; state: StateStore; rt: Realtime; metrics: Metrics; bus: { publishJob: (job: GeminiJob) => void } },
  envelope: IngestEnvelope,
) {
  const started = Date.now();
  deps.metrics.noteLag(started - envelope.receivedAt);
  const patient = await getPatient(deps.db, envelope.patientId);
  if (!patient || patient.status !== "waiting") return;
  await deps.state.update(patient.id, async (prev) => {
    const base = prev ?? parseRuntime(patient.runtime) ?? initialState(patient.id, Number(patient.paired_at), patient.room_temp_c);
    if (envelope.seq <= base.lastSeq) return { state: base, result: null };
    const draft = structuredClone(base) as RuntimeState;
    const applied = applyBatch(draft, { seq: envelope.seq, readings: envelope.readings });
    const latest = [...envelope.readings].sort((a, b) => a.ts - b.ts).at(-1) ?? null;
    const saved = await persistMonitoring(
      deps.db,
      patient.id,
      applied.state,
      latest,
      envelope.seq,
      envelope.deviceId,
      envelope.readings,
      applied.prompts,
    );
    for (const prompt of saved) {
      deps.metrics.noteAlert(Date.now() - envelope.receivedAt);
      await deps.rt.push(patient.unit_id, { type: "prompt", prompt });
      deps.bus.publishJob({
        id: `job_${prompt.id}`,
        type: "explain_prompt",
        patientId: patient.id,
        promptId: prompt.id,
      });
    }
    const highBpmReading = envelope.readings
      .filter((reading) => reading.bpm != null && reading.bpm >= 120)
      .sort((a, b) => (b.bpm ?? 0) - (a.bpm ?? 0))[0];
    if (highBpmReading?.bpm != null) {
      const prompt = await insertPrompt(deps.db, patient.id, {
        kind: "high_bpm_static",
        severity: "urgent",
        message: `Heart rate is ${Math.round(highBpmReading.bpm)} BPM, at or above the 120 BPM safety threshold. Verify the patient and reassess clinically.`,
      }, Date.now(), envelope.seq);
      if (prompt) {
        deps.metrics.noteAlert(Date.now() - envelope.receivedAt);
        await deps.rt.push(patient.unit_id, { type: "prompt", prompt });
      }
    }
    if (latest) {
      const previous = lastPushed.get(patient.id) ?? {
        bpm: bpmOf(patient.last_bpm),
        bpmMin: bpmOf(patient.last_bpm_min),
        bpmMax: bpmOf(patient.last_bpm_max),
      };
      const next: LastHeartRate = {
        bpm: latest.bpm,
        bpmMin: latest.bpmMin ?? null,
        bpmMax: latest.bpmMax ?? null,
      };
      lastPushed.set(patient.id, next);
      if (previous.bpm !== next.bpm || previous.bpmMin !== next.bpmMin || previous.bpmMax !== next.bpmMax) {
        await deps.rt.push(patient.unit_id, {
          type: "heart_rate",
          patientId: patient.id,
          latest: {
            ts: latest.ts,
            bpm: latest.bpm,
            bpmMin: latest.bpmMin ?? null,
            bpmMax: latest.bpmMax ?? null,
            activity: latest.activity,
            skinTempC: latest.skinTempC,
            spo2: latest.spo2,
            signalQuality: latest.signalQuality,
            fallDetected: latest.fallDetected,
          },
          hrBaseline: hrView(applied.state.hr),
        });
      }
      if (process.env.NODE_ENV !== "test" && process.env.GEMINI_API_KEY && latest.bpm != null && Date.now() - (lastAiAnalysis.get(patient.id) ?? 0) >= 30_000) {
        lastAiAnalysis.set(patient.id, Date.now());
        deps.bus.publishJob({ id: randomUUID(), type: "analyze_vitals", patientId: patient.id });
      }
    }
    return { state: applied.state, result: saved };
  });
}

export function attachWorker(bus: MemoryBus, deps: { db: Db; state: StateStore; rt: Realtime; metrics: Metrics }) {
  bus.onReading((envelope) => handleEnvelope({ ...deps, bus }, envelope));
  log.info("worker attached to in-memory bus");
}
