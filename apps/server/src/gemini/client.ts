import { deidentify, handoffPayload, rulesDraft, type SummaryPatient } from "./summary.js";
import { log } from "../log.js";
import { z } from "zod";

const SYSTEM = `You are a documentation assistant for an emergency waiting-room nurse.
You do not diagnose. You do not assign or change triage priority.
Use only the JSON you are given. Do not invent vitals or names.
Call the person "the patient". Plain clinical language, under 120 words.
Remind the nurse the note is a draft to edit.`;

const safetyAssessmentSchema = z.object({
  status: z.enum(["SAFE", "ALERT"]),
  reason: z.string().max(500),
});

export type SafetyAssessment = z.infer<typeof safetyAssessmentSchema>;

function parseSafetyAssessment(text: string): SafetyAssessment | null {
  const json = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = safetyAssessmentSchema.safeParse(JSON.parse(json));
  return parsed.success ? parsed.data : null;
}

export async function analyzeVitals(summary: unknown): Promise<SafetyAssessment | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  try {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey: key });
    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL ?? "gemini-3.8-flash",
      contents: `You are a clinical safety screening assistant, not a physician. Do not diagnose or change triage.
Review only the de-identified wearable data below. The recentBpmStats.readings array contains the past 30 seconds of BPM samples. Analyze that window for sporadic heart rate and use ALERT when its standard deviation is over 30. These are screening thresholds, not a diagnosis. Treat poor signal, activity, and missing values as uncertainty.
Return JSON only with exactly {"status":"SAFE"|"ALERT","reason":string}. Do not return any other status or fields. Keep reason under 500 characters. If status is ALERT, include "AI screening only; verify the patient" in the reason.
JSON:
${JSON.stringify(summary)}`,
      config: { responseMimeType: "application/json" },
    });
    const text = response.text?.trim();
    if (!text) return null;
    return parseSafetyAssessment(text);
  } catch (err) {
    log.error({ err }, "gemini vital analysis failed");
    return null;
  }
}

export async function draftText(task: string, summary: unknown): Promise<{ text: string; source: "gemini" | "rules" }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { text: rulesDraft(task, summary), source: "rules" };
  try {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey: key });
    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL ?? "gemini-3.8-flash",
      contents: `${SYSTEM}\n\nTask: ${task}\nJSON:\n${JSON.stringify(summary)}`,
    });
    const text = response.text?.trim();
    if (!text) return { text: rulesDraft(task, summary), source: "rules" };
    return { text, source: "gemini" };
  } catch (err) {
    log.error({ err }, "gemini call failed");
    return { text: rulesDraft(task, summary), source: "rules" };
  }
}

export { deidentify, handoffPayload, type SummaryPatient };
