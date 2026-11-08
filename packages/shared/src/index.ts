import { z } from "zod";

export const activitySchema = z.enum(["rest", "light", "active"]);
export type Activity = z.infer<typeof activitySchema>;

export const ctasSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);
export type Ctas = z.infer<typeof ctasSchema>;

export const enrollmentReasonSchema = z.enum([
  "chest_pain",
  "abnormal_labs",
  "sob",
  "other",
]);
export type EnrollmentReason = z.infer<typeof enrollmentReasonSchema>;

export const severitySchema = z.enum(["info", "warning", "urgent"]);
export type Severity = z.infer<typeof severitySchema>;

/** CTAS 1 is continuous observation; the board highlights it if 5 minutes pass with no reassessment. */
export const CTAS_REASSESS_MS: Record<Ctas, number> = {
  1: 5 * 60_000,
  2: 15 * 60_000,
  3: 30 * 60_000,
  4: 60 * 60_000,
  5: 120 * 60_000,
};

export const CTAS_LABEL: Record<Ctas, string> = {
  1: "CTAS 1 · Resuscitation",
  2: "CTAS 2 · Emergent",
  3: "CTAS 3 · Urgent",
  4: "CTAS 4 · Less urgent",
  5: "CTAS 5 · Non-urgent",
};

export const readingSchema = z.object({
  ts: z.number(),
  bpm: z.number().nullable(),
  bpmMin: z.number().int().nullable().optional(),
  bpmMax: z.number().int().nullable().optional(),
  ibiMs: z.array(z.number()).default([]),
  signalQuality: z.number().min(0).max(1),
  activity: activitySchema,
  motionMag: z.number(),
  fallDetected: z.boolean(),
  skinTempC: z.number().nullable(),
  spo2: z.number().nullable(),
  spo2Simulated: z.boolean(),
});
export type Reading = z.infer<typeof readingSchema>;

export const readingBatchSchema = z.object({
  deviceId: z.string().min(1),
  seq: z.number().int().nonnegative(),
  readings: z.array(readingSchema).min(1).max(120),
});
export type ReadingBatch = z.infer<typeof readingBatchSchema>;

/** Envelope published after the device is resolved to a patient. */
export const ingestEnvelopeSchema = readingBatchSchema.extend({
  patientId: z.string().min(1),
  receivedAt: z.number(),
});
export type IngestEnvelope = z.infer<typeof ingestEnvelopeSchema>;

export const manualVitalsSchema = z.object({
  tempC: z.number().optional(),
  tempMethod: z.enum(["oral", "tympanic", "temporal"]).optional(),
  sbp: z.number().optional(),
  dbp: z.number().optional(),
  respRate: z.number().optional(),
  pain: z.number().int().min(0).max(10).optional(),
});
export type ManualVitals = z.infer<typeof manualVitalsSchema>;

export const enrollSchema = z.object({
  displayName: z.string().min(1).max(80),
  complaint: z.string().max(500).optional(),
  symptomOnset: z.string().max(120).optional(),
  ctas: ctasSchema,
  enrollmentReason: enrollmentReasonSchema,
  deviceId: z.string().min(1),
  nurseId: z.string().min(1),
  hospitalId: z.string().min(1).default("h-dartmouth"),
  unitId: z.string().min(1).default("ed-waiting"),
  roomTempC: z.number().optional(),
  vitals: manualVitalsSchema.optional(),
});
export type EnrollInput = z.infer<typeof enrollSchema>;

export const nurseActionSchema = z.object({
  nurseId: z.string().min(1),
  action: z.enum([
    "reassessed_no_change",
    "retriage",
    "call_to_treatment",
    "reset_baseline",
    "sensor_issue",
  ]),
  ctas: ctasSchema.optional(),
  note: z.string().max(2000).optional(),
  vitals: manualVitalsSchema.optional(),
});
export type NurseAction = z.infer<typeof nurseActionSchema>;

export const patientReportSchema = z.object({
  code: z.string().min(4),
  pain: z.number().int().min(0).max(10).optional(),
  feelWorse: z.boolean().optional(),
});
export type PatientReport = z.infer<typeof patientReportSchema>;

export const surveySchema = z.object({
  role: z.enum(["staff", "patient"]),
  score: z.number().int().min(1).max(5),
  comment: z.string().max(500).optional(),
});
export type SurveyInput = z.infer<typeof surveySchema>;

export const hrBaselineViewSchema = z.object({
  status: z.enum(["calibrating", "extended", "set", "insufficient"]),
  bpm: z.number().optional(),
  spread: z.number().optional(),
  capturedAt: z.number().optional(),
  abnormalArrival: z.boolean().optional(),
});
export type HrBaselineView = z.infer<typeof hrBaselineViewSchema>;

export const skinBaselineViewSchema = z.object({
  status: z.enum(["warming", "calibrating", "set"]),
  tempC: z.number().optional(),
});
export type SkinBaselineView = z.infer<typeof skinBaselineViewSchema>;

export const promptViewSchema = z.object({
  id: z.string(),
  patientId: z.string(),
  kind: z.string(),
  severity: severitySchema,
  message: z.string(),
  explanation: z.string().nullable(),
  createdAt: z.number(),
  ackedAt: z.number().nullable(),
  ackedBy: z.string().nullable(),
});
export type PromptView = z.infer<typeof promptViewSchema>;

export const latestVitalsSchema = z.object({
  ts: z.number(),
  bpm: z.number().nullable(),
  activity: activitySchema,
  skinTempC: z.number().nullable(),
  spo2: z.number().nullable(),
  signalQuality: z.number(),
  fallDetected: z.boolean(),
});
export type LatestVitals = z.infer<typeof latestVitalsSchema>;

export const patientViewSchema = z.object({
  id: z.string(),
  publicCode: z.string(),
  hospitalId: z.string(),
  unitId: z.string(),
  displayName: z.string(),
  ctas: ctasSchema,
  arrivalTs: z.number(),
  nextReassessAt: z.number(),
  enrollmentReason: enrollmentReasonSchema,
  deviceId: z.string().nullable(),
  status: z.enum(["waiting", "in_treatment"]),
  hrBaseline: hrBaselineViewSchema,
  skinTempBaseline: skinBaselineViewSchema,
  latest: latestVitalsSchema.nullable(),
  openPrompts: z.array(promptViewSchema),
});
export type PatientView = z.infer<typeof patientViewSchema>;

export const jobTypeSchema = z.enum([
  "explain_prompt",
  "reassessment_note",
  "handoff",
  "retrospective",
]);
export type JobType = z.infer<typeof jobTypeSchema>;

export type GeminiJob = {
  id: string;
  type: JobType;
  patientId?: string;
  unitId?: string;
  promptId?: string;
};

export const REASON_LABEL: Record<EnrollmentReason, string> = {
  chest_pain: "Chest pain",
  abnormal_labs: "Abnormal labs",
  sob: "Shortness of breath",
  other: "Other",
};
