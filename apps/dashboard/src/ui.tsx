import type { Ctas, Severity } from "@waitwatch/shared";

export const CTAS_RAIL: Record<Ctas, string> = {
  1: "bg-red-500",
  2: "bg-orange-500",
  3: "bg-amber-400",
  4: "bg-emerald-500",
  5: "bg-sky-500",
};

const CTAS_CHIP: Record<Ctas, string> = {
  1: "bg-red-500/15 text-red-300 ring-red-500/30",
  2: "bg-orange-500/15 text-orange-300 ring-orange-500/30",
  3: "bg-amber-400/15 text-amber-200 ring-amber-400/30",
  4: "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30",
  5: "bg-sky-500/15 text-sky-300 ring-sky-500/30",
};

export function CtasChip({ level }: { level: Ctas }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ring-1 ring-inset ${CTAS_CHIP[level]}`}>
      CTAS {level}
    </span>
  );
}

export const SEVERITY_DOT: Record<Severity, string> = {
  urgent: "bg-rose-400",
  warning: "bg-amber-300",
  info: "bg-sky-400",
};

export function SeverityDot({ severity }: { severity: Severity }) {
  return <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${SEVERITY_DOT[severity]}`} />;
}
