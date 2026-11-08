import type { PatientView, PromptView } from "@waitwatch/shared";

export type BoardResponse = { patients: PatientView[]; serverTime: number };

// Auth0 provides the nurse identity. This value is never trusted by the backend;
// the backend derives the author from the verified JWT subject.
let accessToken: string | null = null;
let activeNurseId = "";
export function setSessionCredentials(token: string | null, subject: string) {
  accessToken = token;
  activeNurseId = subject;
}
export function getSessionToken() { return accessToken; }
export function nurseId() { return activeNurseId || "local-demo-nurse"; }

const FIELD_LABELS: Record<string, string> = {
  displayName: "Name",
  ctas: "CTAS",
  enrollmentReason: "Reason",
  deviceId: "Wearable",
  note: "Note",
  "vitals.tempC": "Temperature",
  "vitals.pain": "Pain",
  "vitals.sbp": "Systolic",
  "vitals.dbp": "Diastolic",
  "vitals.respRate": "Respiratory rate",
};

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  headers.set("x-nurse-id", nurseId());
  if (accessToken) headers.set("authorization", `Bearer ${accessToken}`);
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) throw new Error(formatApiError(await res.text()));
  return res.json() as Promise<T>;
}

/** Turn the server's validation payload into one line per field. */
function formatApiError(raw: string): string {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return raw;
  }
  const error = (body as { error?: unknown }).error;
  if (typeof error === "string") return error === "internal" ? "Something went wrong. Try again." : error;
  if (!Array.isArray(error)) return raw;

  const lines = new Map<string, string[]>();
  for (const item of error) {
    if (!item || typeof item !== "object" || !("message" in item)) continue;
    const field = "field" in item ? String(item.field) : "";
    const label = FIELD_LABELS[field] ?? "";
    const messages = lines.get(label) ?? [];
    messages.push(plainMessage(String(item.message)));
    lines.set(label, messages);
  }
  const text = [...lines.entries()].map(([label, messages]) => (label ? `${label}: ${messages.join(" ")}` : messages.join(" ")));
  return text.length ? text.join("\n") : raw;
}

function plainMessage(message: string): string {
  if (message.startsWith("Expected number")) return "Enter a number.";
  if (message.startsWith("Expected integer")) return "Enter a whole number.";
  if (message.startsWith("Number must be greater than or equal to ")) return `Must be at least ${message.slice(message.lastIndexOf(" ") + 1)}.`;
  if (message.startsWith("Number must be less than or equal to ")) return `Must be at most ${message.slice(message.lastIndexOf(" ") + 1)}.`;
  return message.endsWith(".") ? message : `${message}.`;
}

export function formatRemaining(target: number, now: number) {
  const delta = target - now;
  const abs = Math.abs(delta);
  const min = Math.floor(abs / 60000);
  const sec = Math.floor((abs % 60000) / 1000);
  const text = `${min}m ${sec.toString().padStart(2, "0")}s`;
  return delta < 0 ? `Overdue ${text}` : text;
}

export function worstSeverity(prompts: PromptView[]) {
  if (prompts.some((prompt) => prompt.severity === "urgent")) return "urgent" as const;
  if (prompts.some((prompt) => prompt.severity === "warning")) return "warning" as const;
  if (prompts.length) return "info" as const;
  return null;
}
