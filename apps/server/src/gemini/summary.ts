import type { PromptView } from "@waitwatch/shared";

export type SummaryPatient = {
  id: string;
  displayName?: string;
  ctas: number;
  enrollmentReason: string;
  baselineBpm: number | null;
  skinBaselineC: number | null;
  officialTempC: number | null;
  rollup: { bpmMin: number | null; bpmMax: number | null; bpmAvg: number; skinAvg: number | null } | null;
  flags: Array<Pick<PromptView, "id" | "kind" | "severity" | "message">>;
};

/** Gemini only receives this shape. Names are dropped on purpose. */
export function deidentify(patient: SummaryPatient, flag?: Pick<PromptView, "kind" | "severity" | "message">) {
  return {
    ref: patient.id,
    ctas: patient.ctas,
    enrollmentReason: patient.enrollmentReason,
    baselineBpm: patient.baselineBpm,
    skinBaselineC: patient.skinBaselineC,
    officialTempC: patient.officialTempC,
    recent: patient.rollup,
    flag: flag ?? null,
    openFlags: patient.flags.map((item) => ({ kind: item.kind, severity: item.severity, message: item.message })),
  };
}

export function handoffPayload(patients: SummaryPatient[]) {
  return {
    unit: "waiting-room",
    patients: patients.map((patient) => deidentify(patient)),
  };
}

export function rulesDraft(task: string, summary: unknown): string {
  const data = summary as { patients?: Array<Record<string, unknown>>; ref?: string; flag?: { message?: string } | null; openFlags?: Array<{ message: string }> };
  if (task === "handoff") {
    const lines = (data.patients ?? []).map((patient) => {
      const flags = (patient.openFlags as Array<{ message: string }> | undefined) ?? [];
      const flagText = flags.length ? flags.map((flag) => flag.message).join(" ") : "No open flags.";
      return `Patient ${patient.ref}, CTAS ${patient.ctas}, baseline ${patient.baselineBpm ?? "not set"} bpm. ${flagText}`;
    });
    return `Shift handoff draft (rules-based, Gemini key not set). This does not change triage.\n${lines.join("\n") || "No patients waiting."}`;
  }
  const flags = data.openFlags?.map((flag) => flag.message).join(" ") ?? "";
  const focus = data.flag?.message ? `Focus: ${data.flag.message}` : "";
  return `Draft for the nurse to edit. This does not diagnose and does not change who is seen next. Patient ${data.ref ?? ""}. ${focus} ${flags}`.trim();
}
