import { randomUUID } from "node:crypto";
import type { Reading } from "@waitwatch/shared";
import type { Db } from "./db.js";
import { hrView, skinView, type PromptDraft, type RuntimeState } from "../rules/engine.js";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS devices (
  id text PRIMARY KEY,
  token text UNIQUE NOT NULL,
  patient_id text,
  hospital_id text NOT NULL DEFAULT 'h-dartmouth',
  unit_id text NOT NULL DEFAULT 'ed-waiting'
);
CREATE TABLE IF NOT EXISTS patients (
  id text PRIMARY KEY,
  public_code text UNIQUE NOT NULL,
  hospital_id text NOT NULL,
  unit_id text NOT NULL,
  display_name text NOT NULL,
  ctas int NOT NULL,
  arrival_ts double precision NOT NULL,
  paired_at double precision NOT NULL,
  next_reassess_at double precision NOT NULL,
  enrollment_reason text NOT NULL,
  device_id text,
  status text NOT NULL,
  room_temp_c double precision,
  hr_status text NOT NULL,
  hr_bpm double precision,
  hr_spread double precision,
  hr_captured_at double precision,
  hr_abnormal boolean,
  skin_status text NOT NULL,
  skin_temp_c double precision,
  last_ts double precision,
  last_bpm double precision,
  last_activity text,
  last_skin double precision,
  last_spo2 double precision,
  last_signal double precision,
  last_fall boolean,
  runtime jsonb
);
CREATE TABLE IF NOT EXISTS readings (
  patient_id text NOT NULL,
  ts_ms double precision NOT NULL,
  device_id text NOT NULL,
  seq int NOT NULL,
  bpm double precision,
  ibi_ms jsonb,
  signal_quality double precision,
  activity text,
  motion_mag double precision,
  fall_detected boolean,
  skin_temp_c double precision,
  spo2 double precision,
  spo2_simulated boolean,
  PRIMARY KEY (patient_id, ts_ms)
) PARTITION BY RANGE (ts_ms);
CREATE TABLE IF NOT EXISTS readings_default PARTITION OF readings DEFAULT;
CREATE TABLE IF NOT EXISTS rollups_1m (
  patient_id text NOT NULL,
  bucket double precision NOT NULL,
  bpm_min double precision,
  bpm_max double precision,
  bpm_sum double precision NOT NULL DEFAULT 0,
  bpm_n int NOT NULL DEFAULT 0,
  skin_sum double precision NOT NULL DEFAULT 0,
  skin_n int NOT NULL DEFAULT 0,
  spo2_sum double precision NOT NULL DEFAULT 0,
  spo2_n int NOT NULL DEFAULT 0,
  samples int NOT NULL DEFAULT 0,
  PRIMARY KEY (patient_id, bucket)
);
CREATE TABLE IF NOT EXISTS prompts (
  id text PRIMARY KEY,
  patient_id text NOT NULL,
  kind text NOT NULL,
  severity text NOT NULL,
  message text NOT NULL,
  explanation text,
  created_at double precision NOT NULL,
  acked_at double precision,
  acked_by text,
  source_seq int,
  UNIQUE (patient_id, kind, source_seq)
);
CREATE TABLE IF NOT EXISTS manual_vitals (
  id text PRIMARY KEY,
  patient_id text NOT NULL,
  nurse_id text NOT NULL,
  ts_ms double precision NOT NULL,
  temp_c double precision,
  temp_method text,
  sbp double precision,
  dbp double precision,
  resp_rate double precision,
  pain int
);
CREATE TABLE IF NOT EXISTS audit_events (
  id text PRIMARY KEY,
  patient_id text NOT NULL,
  nurse_id text NOT NULL,
  action text NOT NULL,
  detail jsonb,
  ts_ms double precision NOT NULL,
  on_time boolean
);
CREATE TABLE IF NOT EXISTS jobs (
  id text PRIMARY KEY,
  type text NOT NULL,
  status text NOT NULL,
  payload jsonb NOT NULL,
  result text,
  created_at double precision NOT NULL,
  finished_at double precision
);
CREATE TABLE IF NOT EXISTS surveys (
  id text PRIMARY KEY,
  role text NOT NULL,
  score int NOT NULL,
  comment text,
  ts_ms double precision NOT NULL
);
CREATE INDEX IF NOT EXISTS prompts_patient ON prompts (patient_id, created_at DESC);
CREATE INDEX IF NOT EXISTS patients_unit ON patients (unit_id, status, ctas, arrival_ts);
`;

const PLAIN_READINGS = `
CREATE TABLE IF NOT EXISTS readings (
  patient_id text NOT NULL,
  ts_ms double precision NOT NULL,
  device_id text NOT NULL,
  seq int NOT NULL,
  bpm double precision,
  ibi_ms jsonb,
  signal_quality double precision,
  activity text,
  motion_mag double precision,
  fall_detected boolean,
  skin_temp_c double precision,
  spo2 double precision,
  spo2_simulated boolean,
  PRIMARY KEY (patient_id, ts_ms)
);
`;

export async function migrate(db: Db): Promise<void> {
  try {
    await db.exec(SCHEMA);
    await ensureDayPartitions(db);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (!/partition/i.test(message)) throw err;
    const without = SCHEMA.replace(
      /CREATE TABLE IF NOT EXISTS readings \([\s\S]*?PARTITION BY RANGE \(ts_ms\);\nCREATE TABLE IF NOT EXISTS readings_default PARTITION OF readings DEFAULT;/,
      PLAIN_READINGS,
    );
    await db.exec(without);
  }
}

async function ensureDayPartitions(db: Db) {
  const day = 86_400_000;
  const start = Math.floor(Date.now() / day) * day;
  for (let i = -1; i <= 2; i++) {
    const from = start + i * day;
    const to = from + day;
    const name = `readings_d_${from}`;
    await db.exec(
      `CREATE TABLE IF NOT EXISTS ${name} PARTITION OF readings FOR VALUES FROM (${from}) TO (${to});`,
    );
  }
}

export async function seedDevices(db: Db): Promise<void> {
  for (let i = 1; i <= 16; i++) {
    const id = `device-${String(i).padStart(2, "0")}`;
    await db.query(
      `INSERT INTO devices (id, token) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
      [id, `dev-${id}`],
    );
  }
}

export type PatientRow = {
  id: string;
  public_code: string;
  hospital_id: string;
  unit_id: string;
  display_name: string;
  ctas: number;
  arrival_ts: number;
  paired_at: number;
  next_reassess_at: number;
  enrollment_reason: string;
  device_id: string | null;
  status: string;
  room_temp_c: number | null;
  hr_status: string;
  hr_bpm: number | null;
  hr_spread: number | null;
  hr_captured_at: number | null;
  hr_abnormal: boolean | null;
  skin_status: string;
  skin_temp_c: number | null;
  last_ts: number | null;
  last_bpm: number | null;
  last_activity: string | null;
  last_skin: number | null;
  last_spo2: number | null;
  last_signal: number | null;
  last_fall: boolean | null;
  runtime: RuntimeState | string | null;
};

export type PromptRow = {
  id: string;
  patient_id: string;
  kind: string;
  severity: "info" | "warning" | "urgent";
  message: string;
  explanation: string | null;
  created_at: number;
  acked_at: number | null;
  acked_by: string | null;
  source_seq: number | null;
};

function num(value: unknown): number | null {
  if (value == null) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export function mapPrompt(row: PromptRow) {
  return {
    id: row.id,
    patientId: row.patient_id,
    kind: row.kind,
    severity: row.severity,
    message: row.message,
    explanation: row.explanation,
    createdAt: num(row.created_at) ?? 0,
    ackedAt: num(row.acked_at),
    ackedBy: row.acked_by,
  };
}

export async function board(db: Db, unitId: string) {
  const patients = await db.query<PatientRow>(
    `SELECT * FROM patients WHERE unit_id = $1 AND status = 'waiting' ORDER BY ctas ASC, arrival_ts ASC`,
    [unitId],
  );
  if (patients.rows.length === 0) return [];
  const ids = patients.rows.map((p) => p.id);
  const prompts = await db.query<PromptRow>(
    `SELECT * FROM prompts WHERE patient_id = ANY($1::text[]) AND acked_at IS NULL ORDER BY created_at DESC`,
    [ids],
  );
  const byPatient = new Map<string, PromptRow[]>();
  for (const prompt of prompts.rows) {
    const list = byPatient.get(prompt.patient_id) ?? [];
    list.push(prompt);
    byPatient.set(prompt.patient_id, list);
  }
  return patients.rows.map((row) => toView(row, byPatient.get(row.id) ?? []));
}

export function toView(row: PatientRow, prompts: PromptRow[]) {
  return {
    id: row.id,
    publicCode: row.public_code,
    hospitalId: row.hospital_id,
    unitId: row.unit_id,
    displayName: row.display_name,
    ctas: Number(row.ctas) as 1 | 2 | 3 | 4 | 5,
    arrivalTs: num(row.arrival_ts) ?? 0,
    nextReassessAt: num(row.next_reassess_at) ?? 0,
    enrollmentReason: row.enrollment_reason as "chest_pain" | "abnormal_labs" | "sob" | "other",
    deviceId: row.device_id,
    status: row.status as "waiting" | "in_treatment",
    hrBaseline: {
      status: row.hr_status as "calibrating" | "extended" | "set" | "insufficient",
      bpm: num(row.hr_bpm) ?? undefined,
      spread: num(row.hr_spread) ?? undefined,
      capturedAt: num(row.hr_captured_at) ?? undefined,
      abnormalArrival: row.hr_abnormal ?? undefined,
    },
    skinTempBaseline: {
      status: row.skin_status as "warming" | "calibrating" | "set",
      tempC: num(row.skin_temp_c) ?? undefined,
    },
    latest:
      row.last_ts == null
        ? null
        : {
            ts: num(row.last_ts) ?? 0,
            bpm: num(row.last_bpm),
            activity: (row.last_activity ?? "rest") as "rest" | "light" | "active",
            skinTempC: num(row.last_skin),
            spo2: num(row.last_spo2),
            signalQuality: num(row.last_signal) ?? 0,
            fallDetected: Boolean(row.last_fall),
          },
    openPrompts: prompts.map(mapPrompt),
  };
}

export async function getPatient(db: Db, id: string) {
  const result = await db.query<PatientRow>(`SELECT * FROM patients WHERE id = $1`, [id]);
  return result.rows[0] ?? null;
}

export async function getPatientByCode(db: Db, code: string) {
  const result = await db.query<PatientRow>(`SELECT * FROM patients WHERE public_code = $1`, [code]);
  return result.rows[0] ?? null;
}

export async function deviceByToken(db: Db, token: string) {
  const result = await db.query<{ id: string; token: string; patient_id: string | null }>(
    `SELECT id, token, patient_id FROM devices WHERE token = $1`,
    [token],
  );
  return result.rows[0] ?? null;
}

export async function listDevices(db: Db) {
  const result = await db.query<{ id: string; patient_id: string | null; token: string }>(
    `SELECT id, patient_id, token FROM devices ORDER BY id`,
  );
  return result.rows.map((d) => ({ id: d.id, paired: Boolean(d.patient_id), token: d.token }));
}

export async function ensureDevice(db: Db, id: string) {
  const token = `dev-${id}`;
  await db.query(`INSERT INTO devices (id, token) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [id, token]);
  const result = await db.query<{ id: string; token: string; patient_id: string | null }>(
    `SELECT id, token, patient_id FROM devices WHERE id = $1`,
    [id],
  );
  return result.rows[0];
}

function publicCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
  return s;
}

export async function createPatient(
  db: Db,
  input: {
    displayName: string;
    ctas: number;
    enrollmentReason: string;
    deviceId: string;
    hospitalId: string;
    unitId: string;
    roomTempC: number | null;
    now: number;
    nextReassessAt: number;
  },
) {
  const id = `p_${randomUUID().slice(0, 8)}`;
  const code = publicCode();
  await db.query(
    `INSERT INTO patients (
      id, public_code, hospital_id, unit_id, display_name, ctas, arrival_ts, paired_at, next_reassess_at,
      enrollment_reason, device_id, status, room_temp_c, hr_status, skin_status
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'waiting',$12,'calibrating','warming')`,
    [
      id,
      code,
      input.hospitalId,
      input.unitId,
      input.displayName,
      input.ctas,
      input.now,
      input.now,
      input.nextReassessAt,
      input.enrollmentReason,
      input.deviceId,
      input.roomTempC,
    ],
  );
  await db.query(`UPDATE devices SET patient_id = $1 WHERE id = $2`, [id, input.deviceId]);
  return getPatient(db, id);
}

export async function insertVitals(
  db: Db,
  patientId: string,
  nurseId: string,
  ts: number,
  vitals: {
    tempC?: number;
    tempMethod?: string;
    sbp?: number;
    dbp?: number;
    respRate?: number;
    pain?: number;
  },
) {
  await db.query(
    `INSERT INTO manual_vitals (id, patient_id, nurse_id, ts_ms, temp_c, temp_method, sbp, dbp, resp_rate, pain)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      randomUUID(),
      patientId,
      nurseId,
      ts,
      vitals.tempC ?? null,
      vitals.tempMethod ?? null,
      vitals.sbp ?? null,
      vitals.dbp ?? null,
      vitals.respRate ?? null,
      vitals.pain ?? null,
    ],
  );
}

export async function insertAudit(
  db: Db,
  patientId: string,
  nurseId: string,
  action: string,
  ts: number,
  onTime: boolean | null,
  detail: unknown,
) {
  await db.query(
    `INSERT INTO audit_events (id, patient_id, nurse_id, action, detail, ts_ms, on_time) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)`,
    [randomUUID(), patientId, nurseId, action, JSON.stringify(detail ?? {}), ts, onTime],
  );
}

export async function insertPrompt(
  db: Db,
  patientId: string,
  draft: PromptDraft,
  ts: number,
  sourceSeq: number | null,
) {
  const id = randomUUID();
  if (sourceSeq == null) {
    const inserted = await db.query<PromptRow>(
      `INSERT INTO prompts (id, patient_id, kind, severity, message, created_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [id, patientId, draft.kind, draft.severity, draft.message, ts],
    );
    return inserted.rows[0] ? mapPrompt(inserted.rows[0]) : null;
  }
  const inserted = await db.query<PromptRow>(
    `INSERT INTO prompts (id, patient_id, kind, severity, message, created_at, source_seq)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (patient_id, kind, source_seq) DO NOTHING
     RETURNING *`,
    [id, patientId, draft.kind, draft.severity, draft.message, ts, sourceSeq],
  );
  return inserted.rows[0] ? mapPrompt(inserted.rows[0]) : null;
}

export async function ackOpenPrompts(db: Db, patientId: string, nurseId: string, ts: number) {
  await db.query(
    `UPDATE prompts SET acked_at = $1, acked_by = $2 WHERE patient_id = $3 AND acked_at IS NULL`,
    [ts, nurseId, patientId],
  );
}

export async function persistMonitoring(
  db: Db,
  patientId: string,
  state: RuntimeState,
  latest: Reading | null,
  seq: number,
  deviceId: string,
  readings: Reading[],
  prompts: PromptDraft[],
) {
  await insertReadings(db, patientId, deviceId, seq, readings);
  await upsertRollups(db, patientId, readings);
  const hr = hrView(state.hr);
  const skin = skinView(state.skin);
  await db.query(
    `UPDATE patients SET
      hr_status=$2, hr_bpm=$3, hr_spread=$4, hr_captured_at=$5, hr_abnormal=$6,
      skin_status=$7, skin_temp_c=$8,
      last_ts=$9, last_bpm=$10, last_activity=$11, last_skin=$12, last_spo2=$13, last_signal=$14, last_fall=$15,
      runtime=$16::jsonb
     WHERE id=$1`,
    [
      patientId,
      hr.status,
      hr.bpm ?? null,
      hr.spread ?? null,
      hr.capturedAt ?? null,
      hr.abnormalArrival ?? null,
      skin.status,
      skin.tempC ?? null,
      latest?.ts ?? null,
      latest?.bpm ?? null,
      latest?.activity ?? null,
      latest?.skinTempC ?? null,
      latest?.spo2 ?? null,
      latest?.signalQuality ?? null,
      latest?.fallDetected ?? null,
      JSON.stringify(state),
    ],
  );
  const saved = [];
  for (const prompt of prompts) {
    const row = await insertPrompt(db, patientId, prompt, Date.now(), seq);
    if (row) saved.push(row);
  }
  return saved;
}

async function insertReadings(db: Db, patientId: string, deviceId: string, seq: number, readings: Reading[]) {
  const cols = 13;
  for (let i = 0; i < readings.length; i += 80) {
    const chunk = readings.slice(i, i + 80);
    const params: unknown[] = [];
    const values = chunk.map((r, idx) => {
      const b = idx * cols;
      params.push(
        patientId,
        r.ts,
        deviceId,
        seq,
        r.bpm,
        JSON.stringify(r.ibiMs),
        r.signalQuality,
        r.activity,
        r.motionMag,
        r.fallDetected,
        r.skinTempC,
        r.spo2,
        r.spo2Simulated,
      );
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6}::jsonb,$${b + 7},$${b + 8},$${b + 9},$${b + 10},$${b + 11},$${b + 12},$${b + 13})`;
    });
    await db.query(
      `INSERT INTO readings (patient_id, ts_ms, device_id, seq, bpm, ibi_ms, signal_quality, activity, motion_mag, fall_detected, skin_temp_c, spo2, spo2_simulated)
       VALUES ${values.join(",")} ON CONFLICT DO NOTHING`,
      params,
    );
  }
}

async function upsertRollups(db: Db, patientId: string, readings: Reading[]) {
  const buckets = new Map<number, { min: number | null; max: number | null; sum: number; n: number; skinSum: number; skinN: number; spo2Sum: number; spo2N: number; samples: number }>();
  for (const r of readings) {
    const bucket = Math.floor(r.ts / 60_000) * 60_000;
    const acc = buckets.get(bucket) ?? { min: null, max: null, sum: 0, n: 0, skinSum: 0, skinN: 0, spo2Sum: 0, spo2N: 0, samples: 0 };
    if (r.bpm != null) {
      acc.min = acc.min == null ? r.bpm : Math.min(acc.min, r.bpm);
      acc.max = acc.max == null ? r.bpm : Math.max(acc.max, r.bpm);
      acc.sum += r.bpm;
      acc.n += 1;
    }
    if (r.skinTempC != null) {
      acc.skinSum += r.skinTempC;
      acc.skinN += 1;
    }
    if (r.spo2 != null) {
      acc.spo2Sum += r.spo2;
      acc.spo2N += 1;
    }
    acc.samples += 1;
    buckets.set(bucket, acc);
  }
  for (const [bucket, acc] of buckets) {
    await db.query(
      `INSERT INTO rollups_1m (patient_id, bucket, bpm_min, bpm_max, bpm_sum, bpm_n, skin_sum, skin_n, spo2_sum, spo2_n, samples)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (patient_id, bucket) DO UPDATE SET
         bpm_min = LEAST(COALESCE(rollups_1m.bpm_min, EXCLUDED.bpm_min), COALESCE(EXCLUDED.bpm_min, rollups_1m.bpm_min)),
         bpm_max = GREATEST(COALESCE(rollups_1m.bpm_max, EXCLUDED.bpm_max), COALESCE(EXCLUDED.bpm_max, rollups_1m.bpm_max)),
         bpm_sum = rollups_1m.bpm_sum + EXCLUDED.bpm_sum,
         bpm_n = rollups_1m.bpm_n + EXCLUDED.bpm_n,
         skin_sum = rollups_1m.skin_sum + EXCLUDED.skin_sum,
         skin_n = rollups_1m.skin_n + EXCLUDED.skin_n,
         spo2_sum = rollups_1m.spo2_sum + EXCLUDED.spo2_sum,
         spo2_n = rollups_1m.spo2_n + EXCLUDED.spo2_n,
         samples = rollups_1m.samples + EXCLUDED.samples`,
      [patientId, bucket, acc.min, acc.max, acc.sum, acc.n, acc.skinSum, acc.skinN, acc.spo2Sum, acc.spo2N, acc.samples],
    );
  }
}

export async function saveRuntimeColumns(db: Db, state: RuntimeState) {
  const hr = hrView(state.hr);
  const skin = skinView(state.skin);
  await db.query(
    `UPDATE patients SET hr_status=$2, hr_bpm=$3, hr_spread=$4, hr_captured_at=$5, hr_abnormal=$6, skin_status=$7, skin_temp_c=$8, runtime=$9::jsonb WHERE id=$1`,
    [state.patientId, hr.status, hr.bpm ?? null, hr.spread ?? null, hr.capturedAt ?? null, hr.abnormalArrival ?? null, skin.status, skin.tempC ?? null, JSON.stringify(state)],
  );
}

export async function setCtas(db: Db, id: string, ctas: number, nextReassessAt: number) {
  await db.query(`UPDATE patients SET ctas=$2, next_reassess_at=$3 WHERE id=$1`, [id, ctas, nextReassessAt]);
}

export async function markReassessed(db: Db, id: string, nextReassessAt: number) {
  await db.query(`UPDATE patients SET next_reassess_at=$2 WHERE id=$1`, [id, nextReassessAt]);
}

export async function callToTreatment(db: Db, id: string) {
  const patient = await getPatient(db, id);
  if (!patient) return;
  await db.query(`UPDATE patients SET status='in_treatment', device_id=NULL WHERE id=$1`, [id]);
  if (patient.device_id) await db.query(`UPDATE devices SET patient_id=NULL WHERE id=$1`, [patient.device_id]);
}

export async function timeline(db: Db, id: string) {
  const since = Date.now() - 24 * 60 * 60_000;
  const [readings, rollups, prompts, vitals, audits, notes] = await Promise.all([
    db.query(`SELECT * FROM readings WHERE patient_id=$1 AND ts_ms >= $2 ORDER BY ts_ms ASC LIMIT 4000`, [id, Date.now() - 6 * 60 * 60_000]),
    db.query(`SELECT * FROM rollups_1m WHERE patient_id=$1 AND bucket >= $2 ORDER BY bucket ASC`, [id, since]),
    db.query<PromptRow>(`SELECT * FROM prompts WHERE patient_id=$1 ORDER BY created_at ASC`, [id]),
    db.query(`SELECT * FROM manual_vitals WHERE patient_id=$1 ORDER BY ts_ms ASC`, [id]),
    db.query(`SELECT * FROM audit_events WHERE patient_id=$1 ORDER BY ts_ms ASC`, [id]),
    db.query(`SELECT id, type, status, result, created_at FROM jobs WHERE payload->>'patientId' = $1 ORDER BY created_at DESC LIMIT 20`, [id]),
  ]);
  return {
    readings: readings.rows,
    rollups: rollups.rows,
    prompts: prompts.rows.map(mapPrompt),
    vitals: vitals.rows,
    audits: audits.rows,
    notes: notes.rows,
  };
}

export async function createJob(db: Db, id: string, type: string, payload: unknown) {
  await db.query(
    `INSERT INTO jobs (id, type, status, payload, created_at) VALUES ($1,$2,'queued',$3::jsonb,$4)`,
    [id, type, JSON.stringify(payload), Date.now()],
  );
}

export async function finishJob(db: Db, id: string, result: string, status = "done") {
  await db.query(`UPDATE jobs SET status=$2, result=$3, finished_at=$4 WHERE id=$1`, [id, status, result, Date.now()]);
}

export async function getJob(db: Db, id: string) {
  const result = await db.query<{ id: string; type: string; status: string; result: string | null; payload: unknown }>(
    `SELECT id, type, status, result, payload FROM jobs WHERE id=$1`,
    [id],
  );
  return result.rows[0] ?? null;
}

export async function setPromptExplanation(db: Db, promptId: string, explanation: string) {
  await db.query(`UPDATE prompts SET explanation=$2 WHERE id=$1`, [promptId, explanation]);
}

export async function recentRollup(db: Db, patientId: string) {
  const since = Date.now() - 30 * 60_000;
  const result = await db.query<{ bpm_min: number | null; bpm_max: number | null; bpm_sum: number; bpm_n: number; skin_sum: number; skin_n: number }>(
    `SELECT MIN(bpm_min) AS bpm_min, MAX(bpm_max) AS bpm_max, SUM(bpm_sum) AS bpm_sum, SUM(bpm_n) AS bpm_n, SUM(skin_sum) AS skin_sum, SUM(skin_n) AS skin_n
     FROM rollups_1m WHERE patient_id=$1 AND bucket >= $2`,
    [patientId, since],
  );
  const row = result.rows[0];
  if (!row || !row.bpm_n) return null;
  return {
    bpmMin: num(row.bpm_min),
    bpmMax: num(row.bpm_max),
    bpmAvg: Number(row.bpm_sum) / Number(row.bpm_n),
    skinAvg: Number(row.skin_n) ? Number(row.skin_sum) / Number(row.skin_n) : null,
  };
}

export async function lastOfficialTemp(db: Db, patientId: string) {
  const result = await db.query<{ temp_c: number | null }>(
    `SELECT temp_c FROM manual_vitals WHERE patient_id=$1 AND temp_c IS NOT NULL ORDER BY ts_ms DESC LIMIT 1`,
    [patientId],
  );
  return num(result.rows[0]?.temp_c ?? null);
}

export async function openPromptRows(db: Db, patientId: string) {
  const result = await db.query<PromptRow>(
    `SELECT * FROM prompts WHERE patient_id=$1 AND acked_at IS NULL ORDER BY created_at DESC`,
    [patientId],
  );
  return result.rows;
}

export async function unitPatients(db: Db, unitId: string) {
  const result = await db.query<PatientRow>(
    `SELECT * FROM patients WHERE unit_id=$1 AND status='waiting' ORDER BY ctas, arrival_ts`,
    [unitId],
  );
  return result.rows;
}

export async function insertSurvey(db: Db, role: string, score: number, comment: string | undefined) {
  await db.query(`INSERT INTO surveys (id, role, score, comment, ts_ms) VALUES ($1,$2,$3,$4,$5)`, [
    randomUUID(),
    role,
    score,
    comment ?? null,
    Date.now(),
  ]);
}

export async function qi(db: Db, unitId: string) {
  const now = Date.now();
  const [events, acks, compliance, devices, surveys, overdue, waiting] = await Promise.all([
    db.query<{ kind: string; n: number }>(
      `SELECT p.kind, COUNT(*)::int AS n FROM prompts p JOIN patients pt ON pt.id = p.patient_id WHERE pt.unit_id=$1 GROUP BY p.kind ORDER BY n DESC`,
      [unitId],
    ),
    db.query<{ created_at: number; acked_at: number }>(
      `SELECT p.created_at, p.acked_at FROM prompts p JOIN patients pt ON pt.id = p.patient_id WHERE pt.unit_id=$1 AND p.acked_at IS NOT NULL`,
      [unitId],
    ),
    db.query<{ on_time: boolean | null; n: number }>(
      `SELECT a.on_time, COUNT(*)::int AS n FROM audit_events a JOIN patients pt ON pt.id = a.patient_id
       WHERE pt.unit_id=$1 AND a.action IN ('reassessed_no_change','retriage') GROUP BY a.on_time`,
      [unitId],
    ),
    db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM devices WHERE patient_id IS NOT NULL`),
    db.query<{ role: string; avg: number; n: number }>(`SELECT role, AVG(score)::float AS avg, COUNT(*)::int AS n FROM surveys GROUP BY role`),
    db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM patients WHERE unit_id=$1 AND status='waiting' AND next_reassess_at < $2`, [unitId, now]),
    db.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM patients WHERE unit_id=$1 AND status='waiting'`, [unitId]),
  ]);
  const delays = acks.rows.map((r) => Number(r.acked_at) - Number(r.created_at)).sort((a, b) => a - b);
  const mid = delays.length === 0 ? null : delays[Math.floor(delays.length / 2)];
  let onTime = 0;
  let late = 0;
  for (const row of compliance.rows) {
    if (row.on_time) onTime += Number(row.n);
    else late += Number(row.n);
  }
  return {
    eventsByKind: events.rows.map((r) => ({ kind: r.kind, count: Number(r.n) })),
    medianAckMs: mid,
    ackSamples: delays.length,
    reassessmentsOnTime: onTime,
    reassessmentsLate: late,
    compliance: onTime + late === 0 ? null : onTime / (onTime + late),
    devicesInUse: Number(devices.rows[0]?.n ?? 0),
    surveys: surveys.rows.map((r) => ({ role: r.role, average: Number(r.avg), count: Number(r.n) })),
    overdue: Number(overdue.rows[0]?.n ?? 0),
    waiting: Number(waiting.rows[0]?.n ?? 0),
  };
}

export async function duePatients(db: Db, now: number) {
  return db.query<{ id: string; unit_id: string }>(
    `SELECT id, unit_id FROM patients p WHERE status='waiting' AND next_reassess_at < $1
     AND NOT EXISTS (SELECT 1 FROM prompts pr WHERE pr.patient_id = p.id AND pr.kind = 'reassessment_due' AND pr.acked_at IS NULL)`,
    [now],
  );
}

export function parseRuntime(value: PatientRow["runtime"]): RuntimeState | null {
  if (!value) return null;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as RuntimeState;
    } catch {
      return null;
    }
  }
  return value;
}
