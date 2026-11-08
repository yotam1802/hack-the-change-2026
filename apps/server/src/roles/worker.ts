import { randomUUID } from "node:crypto";
import type { GeminiJob, IngestEnvelope } from "@waitwatch/shared";
import type { Db } from "../db/db.js";
import { getPatient, parseRuntime, persistMonitoring } from "../db/repo.js";
import { applyBatch, hrView, initialState, type RuntimeState } from "../rules/engine.js";
import type { MemoryBus } from "../bus/memory.js";
import type { Metrics } from "../metrics.js";
import type { Realtime } from "../realtime/hub.js";
import type { StateStore } from "../state/store.js";
import { log } from "../log.js";

/** Last bpm persisted for each patient, so a repeat of the same value is not pushed. */
const knownBpm = new Map<string, number | null>();
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
    if (latest) {
      const previousBpm = knownBpm.has(patient.id) ? knownBpm.get(patient.id)! : bpmOf(patient.last_bpm);
      const nextBpm = latest.bpm;
      knownBpm.set(patient.id, nextBpm);
      if (previousBpm !== nextBpm) {
        await deps.rt.push(patient.unit_id, {
          type: "heart_rate",
          patientId: patient.id,
          latest: {
            ts: latest.ts,
            bpm: latest.bpm,
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
