import type { Ctas } from "@waitwatch/shared";

/** CTAS colours follow the usual triage convention: 1 blue, 2 red, 3 yellow, 4 green, 5 white. */
export const CTAS_COLOR: Record<Ctas, string> = {
  1: "#60a5fa",
  2: "#f87171",
  3: "#facc15",
  4: "#4ade80",
  5: "#e6e9ed",
};

export function CtasLabel({ level, className = "" }: { level: Ctas; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 text-sm ${className}`}>
      <span className="inline-block h-2 w-2 rounded-full" style={{ background: CTAS_COLOR[level] }} />
      CTAS {level}
    </span>
  );
}
