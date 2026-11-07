import { deidentify, handoffPayload, rulesDraft, type SummaryPatient } from "./summary.js";
import { log } from "../log.js";

const SYSTEM = `You are a documentation assistant for an emergency waiting-room nurse.
You do not diagnose. You do not assign or change triage priority.
Use only the JSON you are given. Do not invent vitals or names.
Call the person "the patient". Plain clinical language, under 120 words.
Remind the nurse the note is a draft to edit.`;

export async function draftText(task: string, summary: unknown): Promise<{ text: string; source: "gemini" | "rules" }> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return { text: rulesDraft(task, summary), source: "rules" };
  try {
    const { GoogleGenAI } = await import("@google/genai");
    const ai = new GoogleGenAI({ apiKey: key });
    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL ?? "gemini-2.5-flash",
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
