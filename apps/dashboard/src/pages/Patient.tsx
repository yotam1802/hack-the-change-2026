import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { CartesianGrid, Line, LineChart, ReferenceArea, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { REASON_LABEL, type PatientView, type PromptView } from "@waitwatch/shared";
import { api } from "../api";
import { CtasLabel } from "../ui";

const SEVERITY_COLOR: Record<PromptView["severity"], string> = {
  urgent: "#f87171",
  warning: "#facc15",
  info: "#6b7480",
};

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
    <div className="mx-auto max-w-5xl space-y-8 px-6 py-8">
      <div>
        <Link to="/dashboard" className="text-sm text-fg-muted hover:text-fg">← Waiting room</Link>
        <h1 className="mt-3 text-xl font-semibold">{patient.displayName}</h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-3 text-sm text-fg-muted">
          <CtasLabel level={patient.ctas} />
          <span>{REASON_LABEL[patient.enrollmentReason]}</span>
        </p>
      </div>

      <section>
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-sm font-medium">Heart rate</h2>
          {chart.baseline && <span className="text-sm text-fg-muted">Baseline {Math.round(chart.baseline)} bpm, shaded ±10</span>}
        </div>
        <div className="card h-72 p-4">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chart.points} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
              <CartesianGrid stroke="#262d36" vertical={false} />
              <XAxis dataKey="ts" type="number" domain={["dataMin", "dataMax"]} scale="time" tickFormatter={time} minTickGap={64} stroke="#262d36" tick={{ fill: "#9aa3ad", fontSize: 12 }} tickLine={false} />
              <YAxis domain={chart.domain} ticks={chart.ticks} stroke="#262d36" tick={{ fill: "#9aa3ad", fontSize: 12 }} tickLine={false} axisLine={false} width={44} />
              <Tooltip
                labelFormatter={(value) => time(Number(value))}
                formatter={(value) => [`${value} bpm`, "Heart rate"]}
                contentStyle={{ background: "#161b21", border: "1px solid #262d36", borderRadius: 6, fontSize: 12 }}
                labelStyle={{ color: "#9aa3ad" }}
                itemStyle={{ color: "#e6e9ed" }}
              />
              {chart.baseline && <ReferenceArea y1={chart.baseline - 10} y2={chart.baseline + 10} fill="#9aa3ad" fillOpacity={0.08} strokeOpacity={0} />}
              {chart.baseline && <ReferenceLine y={chart.baseline} stroke="#9aa3ad" strokeDasharray="4 4" />}
              <Line type="monotone" dataKey="bpm" stroke="#e6e9ed" strokeWidth={1.5} dot={false} isAnimationActive={false} connectNulls={false} name="Heart rate" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <div className="grid gap-8 md:grid-cols-2">
        <Section title="Prompts" count={data.prompts.length}>
          {data.prompts.map((prompt) => (
            <li key={prompt.id} className="flex items-start gap-3 py-2">
              <span className="w-16 shrink-0 tabular-nums text-fg-faint">{time(prompt.createdAt)}</span>
              <span className="mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: SEVERITY_COLOR[prompt.severity] }} />
              <span>{prompt.message}</span>
            </li>
          ))}
        </Section>
        <div className="space-y-8">
          <Section title="Vitals recorded by staff" count={data.vitals.length}>
            {data.vitals.map((row, index) => (
              <li key={index} className="flex items-baseline gap-3 py-2">
                <span className="w-16 shrink-0 tabular-nums text-fg-faint">{time(row.ts_ms)}</span>
                <span className="text-fg-muted">{row.nurse_id}</span>
                <span className="ml-auto tabular-nums">Temp {row.temp_c ?? "—"} °C, pain {row.pain ?? "—"}</span>
              </li>
            ))}
          </Section>
          <Section title="Actions" count={data.audits.length}>
            {data.audits.map((row, index) => (
              <li key={index} className="flex items-baseline gap-3 py-2">
                <span className="w-16 shrink-0 tabular-nums text-fg-faint">{time(row.ts_ms)}</span>
                <span className="text-fg-muted">{row.nurse_id}</span>
                <span className="ml-auto">{row.action.replaceAll("_", " ")}{row.on_time == null ? "" : row.on_time ? " (on time)" : " (late)"}</span>
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
    <section>
      <h2 className="text-sm font-medium">{title}</h2>
      <ul className="mt-2 max-h-80 divide-y divide-line overflow-y-auto border-t border-line text-sm">
        {count === 0 && <li className="py-2 text-fg-muted">Nothing recorded.</li>}
        {children}
      </ul>
    </section>
  );
}
