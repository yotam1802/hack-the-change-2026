import type { PatientView, PromptView } from "@waitwatch/shared";

export type BoardResponse = { patients: PatientView[]; serverTime: number };

const NURSE_KEY = "waitwatch-nurse";

export const NURSES = [
  { id: "n-1", name: "A. Singh" },
  { id: "n-2", name: "M. Chen" },
  { id: "n-3", name: "J. Patel" },
];

export function nurseId() {
  return localStorage.getItem(NURSE_KEY) ?? "n-1";
}

export function setNurseId(id: string) {
  localStorage.setItem(NURSE_KEY, id);
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  headers.set("x-nurse-id", nurseId());
  const res = await fetch(path, { ...init, headers });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<T>;
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
