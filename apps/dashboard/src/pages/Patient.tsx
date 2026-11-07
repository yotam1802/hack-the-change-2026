import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { REASON_LABEL, type PatientView, type PromptView } from "@waitwatch/shared";
import { api } from "../api";
import { CtasChip, SeverityDot } from "../ui";

type Timeline = {
  patient: PatientView;
  readings: Array<{ ts_ms: number; bpm: number | null; skin_temp_c: number | null }>;
  prompts: PromptView[];
  vitals: Array<{ ts_ms: number; temp_c: number | null; nurse_id: string; pain: number | null }>;
  audits: Array<{ ts_ms: number; action: string; nurse_id: string; on_time: boolean | null }>;
  notes: Array<{ id: string; type: string; result: string | null; status: string }>;
};

/** Clinical monitor range. The axis never zooms in tighter than this, so a 68→72 drift reads as the small change it is. */
const HR_FLOOR = 40;
const HR_CEIL = 160;
const HR_STEP = 20;
const MAX_POINTS = 720;

const time = (ms: number) => new Date(Number(ms)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

export function PatientPage() {
  const { id = "" } = useParams();
  const [data, setData] = useState<Timeline | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Timeline>(`/api/patients/${id}/timeline`).then(setData).catch((err) => setError(String(err)));
  }, [id]);

  const chart = useMemo(() => {
    if (!data) return null;
    const stride = Math.max(1, Math.ceil(data.readings.length / MAX_POINTS));
    const points = data.readings
      .filter((_, index) => index % stride === 0 || index === data.readings.length - 1)
      .map((row) => ({ ts: Number(row.ts_ms), bpm: row.bpm }));
    const values = points.map((p) => p.bpm).filter((n): n is number => n != null);
    const baseline = data.patient.hrBaseline.bpm;
    const lo = Math.min(HR_FLOOR, ...values, baseline ?? HR_FLOOR);
    const hi = Math.max(HR_CEIL, ...values, baseline ?? HR_CEIL);
    const min = Math.floor(lo / HR_STEP) * HR_STEP;
    const max = Math.ceil(hi / HR_STEP) * HR_STEP;
    const ticks: number[] = [];
    for (let t = min; t <= max; t += HR_STEP) ticks.push(t);
    return { points, domain: [min, max] as [number, number], ticks, baseline };
  }, [data]);

  if (error) return <p className="p-6 text-sm text-red-300">{error}</p>;
  if (!data || !chart) return <p className="p-6 text-sm text-fg-muted">Loading timeline…</p>;

  const { patient } = data;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div>
        <Link to="/" className="text-xs text-fg-muted hover:text-fg">← Monitor</Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight">{patient.displayName}</h1>
          <CtasChip level={patient.ctas} />
          <span className="text-sm text-fg-muted">{REASON_LABEL[patient.enrollmentReason]}</span>
        </div>
        <p className="mt-1 text-sm text-fg-muted">Retrospective review. Skin temperature is approximate; SpO₂ in this build is simulated.</p>
      </div>

      <section className="card p-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold">Heart rate</h2>
          <div className="flex items-center gap-4 text-xs text-fg-muted">
            <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 bg-sky-400" />Heart rate</span>
            {chart.baseline && <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 border-t border-dashed border-amber-300" />Baseline {Math.round(chart.baseline)} bpm</span>}
            {chart.baseline && <span className="flex items-center gap-1.5"><span className="h-3 w-4 rounded-sm bg-emerald-400/15" />±10 bpm band</span>}
          </div>
        </div>
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chart.points} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid stroke="#1c2531" vertical={false} />
              <XAxis dataKey="ts" type="number" domain={["dataMin", "dataMax"]} scale="time" tickFormatter={time} minTickGap={64} stroke="#2a3542" tick={{ fill: "#8b98a8", fontSize: 11 }} tickLine={false} />
              <YAxis domain={chart.domain} ticks={chart.ticks} stroke="#2a3542" tick={{ fill: "#8b98a8", fontSize: 11 }} tickLine={false} axisLine={false} width={44} />
              <Tooltip
                labelFormatter={(value) => time(Number(value))}
                formatter={(value) => [`${value} bpm`, "Heart rate"]}
                contentStyle={{ background: "#121821", border: "1px solid #222c3a", borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: "#8b98a8" }}
                itemStyle={{ color: "#e8eef5" }}
              />
              {chart.baseline && <ReferenceArea y1={chart.baseline - 10} y2={chart.baseline + 10} fill="#34d399" fillOpacity={0.08} strokeOpacity={0} />}
              {chart.baseline && <ReferenceLine y={chart.baseline} stroke="#fbbf24" strokeDasharray="4 4" strokeOpacity={0.8} />}
              <Line type="monotone" dataKey="bpm" stroke="#38bdf8" strokeWidth={2} dot={false} isAnimationActive={false} connectNulls={false} name="Heart rate" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <Section title="Prompts" count={data.prompts.length}>
          {data.prompts.map((prompt) => (
            <li key={prompt.id} className="flex items-start gap-2.5 py-2">
              <SeverityDot severity={prompt.severity} />
              <span className="w-16 shrink-0 tabular-nums text-fg-faint">{time(prompt.createdAt)}</span>
              <span className="leading-snug">{prompt.message}</span>
            </li>
          ))}
        </Section>
        <div className="space-y-6">
          <Section title="Nurse-recorded vitals" count={data.vitals.length}>
            {data.vitals.map((row, index) => (
              <li key={index} className="flex items-center gap-2.5 py-2">
                <span className="w-16 shrink-0 tabular-nums text-fg-faint">{time(row.ts_ms)}</span>
                <span className="text-fg-muted">{row.nurse_id}</span>
                <span className="ml-auto tabular-nums">temp {row.temp_c ?? "—"}°C · pain {row.pain ?? "—"}</span>
              </li>
            ))}
          </Section>
          <Section title="Audit" count={data.audits.length}>
            {data.audits.map((row, index) => (
              <li key={index} className="flex items-center gap-2.5 py-2">
                <span className="w-16 shrink-0 tabular-nums text-fg-faint">{time(row.ts_ms)}</span>
                <span className="text-fg-muted">{row.nurse_id}</span>
                <span className="ml-auto">{row.action.replaceAll("_", " ")}</span>
                {row.on_time != null && (
                  <span className={`rounded-md px-1.5 py-0.5 text-[11px] ${row.on_time ? "bg-emerald-500/10 text-emerald-300" : "bg-amber-400/15 text-amber-200"}`}>{row.on_time ? "on time" : "late"}</span>
                )}
              </li>
            ))}
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, count, children }: { title: string; count: number; children: ReactNode }) {
  return (
    <section className="card p-5">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="text-xs tabular-nums text-fg-faint">{count}</span>
      </div>
      <ul className="mt-2 max-h-80 divide-y divide-line overflow-y-auto text-sm">
        {count === 0 && <li className="py-2 text-fg-muted">Nothing recorded.</li>}
        {children}
      </ul>
    </section>
  );
}
