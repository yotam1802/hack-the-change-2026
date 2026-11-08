import { randomUUID } from "node:crypto";
import type { GeminiJob } from "@waitwatch/shared";
import type { Db } from "../db/db.js";
import {
  createJob,
  finishJob,
  getPatient,
  insertPrompt,
  lastOfficialTemp,
  openPromptRows,
  recentRollup,
  setPromptExplanation,
  unitPatients,
} from "../db/repo.js";
import { analyzeVitals, draftText, handoffPayload, type SummaryPatient } from "../gemini/client.js";
import { mapPrompt } from "../db/repo.js";
import { deidentify } from "../gemini/summary.js";
import type { Realtime } from "../realtime/hub.js";
import { log } from "../log.js";

async function summaryFor(db: Db, patientId: string): Promise<SummaryPatient | null> {
  const patient = await getPatient(db, patientId);
  if (!patient) return null;
  const [rollup, temp, prompts] = await Promise.all([
    recentRollup(db, patientId),
    lastOfficialTemp(db, patientId),
    openPromptRows(db, patientId),
  ]);
  return {
    id: patient.id,
    displayName: patient.display_name,
    ctas: Number(patient.ctas),
    enrollmentReason: patient.enrollment_reason,
    baselineBpm: patient.hr_bpm == null ? null : Number(patient.hr_bpm),
    skinBaselineC: patient.skin_temp_c == null ? null : Number(patient.skin_temp_c),
    officialTempC: temp,
    rollup,
    latest: patient.last_ts == null ? null : {
      ts: Number(patient.last_ts),
      bpm: patient.last_bpm == null ? null : Number(patient.last_bpm),
      activity: patient.last_activity,
      signalQuality: patient.last_signal == null ? null : Number(patient.last_signal),
      spo2: patient.last_spo2 == null ? null : Number(patient.last_spo2),
    },
    flags: prompts.map(mapPrompt),
  };
}

export async function runJob(db: Db, rt: Realtime, job: GeminiJob) {
  await createJob(db, job.id, job.type, job).catch(() => undefined);
  try {
    let text = "";
    if (job.type === "handoff") {
      const rows = await unitPatients(db, job.unitId ?? "ed-waiting");
      const patients: SummaryPatient[] = [];
      for (const row of rows) {
        const summary = await summaryFor(db, row.id);
        if (summary) patients.push(summary);
      }
      const drafted = await draftText("handoff", handoffPayload(patients));
      text = drafted.text;
    } else if (job.type === "analyze_vitals" && job.patientId) {
      const summary = await summaryFor(db, job.patientId);
      if (!summary) throw new Error("patient missing");
      const assessment = await analyzeVitals(deidentify(summary));
      if (assessment?.serious) {
        const patient = await getPatient(db, job.patientId);
        if (patient) {
          const prompt = await insertPrompt(db, patient.id, {
            kind: "ai_serious_vital",
            severity: "urgent",
            message: `AI screening flagged a potentially serious vital pattern: ${assessment.reason}`,
          }, Date.now(), summary.latest?.ts ?? null);
          if (prompt) await rt.push(patient.unit_id, { type: "prompt", prompt });
        }
      }
      text = assessment?.reason ?? "AI screening found no serious pattern. Verify the patient and vitals on screen.";
    } else if (job.patientId) {
      const summary = await summaryFor(db, job.patientId);
      if (!summary) throw new Error("patient missing");
      const flag = job.promptId ? summary.flags.find((item) => item.id === job.promptId) : summary.flags[0];
      const { deidentify } = await import("../gemini/summary.js");
      const drafted = await draftText(job.type, deidentify(summary, flag));
      text = drafted.text;
      if (job.promptId) await setPromptExplanation(db, job.promptId, text);
    }

    await finishJob(db, job.id, text, "done");
    if (job.unitId) await rt.push(job.unitId, { type: "job", jobId: job.id, result: text });
    else if (job.patientId) {
      const patient = await getPatient(db, job.patientId);
      if (patient) await rt.push(patient.unit_id, { type: "job", jobId: job.id, patientId: job.patientId, result: text });
    }
  } catch (err) {
    log.error({ err, job: job.id }, "gemini job failed");
    await finishJob(db, job.id, "The draft could not be generated. Reassess using the vitals on screen.", "error");
  }
}

export function queueJob(publish: (job: GeminiJob) => void, job: Omit<GeminiJob, "id"> & { id?: string }) {
  const full: GeminiJob = { ...job, id: job.id ?? randomUUID() };
  publish(full);
  return full.id;
}
