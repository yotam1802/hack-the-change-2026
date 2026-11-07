import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { PatientView, PromptView } from "@waitwatch/shared";
import { api } from "../api";

type Timeline = {
  patient: PatientView;
  readings: Array<{ ts_ms: number; bpm: number | null; skin_temp_c: number | null }>;
  prompts: PromptView[];
  vitals: Array<{ ts_ms: number; temp_c: number | null; nurse_id: string; pain: number | null }>;
  audits: Array<{ ts_ms: number; action: string; nurse_id: string; on_time: boolean | null }>;
  notes: Array<{ id: string; type: string; result: string | null; status: string }>;
};

export function PatientPage() {
  const { id = "" } = useParams();
  const [data, setData] = useState<Timeline | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api<Timeline>(`/api/patients/${id}/timeline`).then(setData).catch((err) => setError(String(err)));
  }, [id]);

  if (error) return <p className="p-6 text-red-300">{error}</p>;
  if (!data) return <p className="p-6 text-slate-400">Loading timeline…</p>;
  const points = data.readings.map((row) => ({
    t: new Date(Number(row.ts_ms)).toLocaleTimeString(),
    bpm: row.bpm,
    skin: row.skin_temp_c,
  }));
  return (
    <div className="space-y-4 p-4">
      <h1 className="text-xl font-semibold">{data.patient.displayName}</h1>
      <p className="text-sm text-slate-400">Retrospective review. Skin temperature is approximate. SpO2 in this build is simulated.</p>
      <div className="h-72 rounded bg-slate-900 p-2">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={points}>
            <CartesianGrid stroke="#243041" />
            <XAxis dataKey="t" hide />
            <YAxis domain={["auto", "auto"]} stroke="#94a3b8" />
            <Tooltip />
            <Line type="monotone" dataKey="bpm" stroke="#38bdf8" dot={false} name="Heart rate" />
            {data.patient.hrBaseline.bpm && <ReferenceLine y={data.patient.hrBaseline.bpm} stroke="#fbbf24" label="Baseline" />}
          </LineChart>
        </ResponsiveContainer>
      </div>
      <section>
        <h2 className="text-sm font-semibold text-slate-300">Prompts</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {data.prompts.map((prompt) => <li key={prompt.id}>{new Date(prompt.createdAt).toLocaleTimeString()} · {prompt.severity} · {prompt.message}</li>)}
        </ul>
      </section>
      <section>
        <h2 className="text-sm font-semibold text-slate-300">Nurse-recorded vitals</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {data.vitals.map((row, index) => <li key={index}>{row.nurse_id}: temp {row.temp_c ?? "—"}°C, pain {row.pain ?? "—"}</li>)}
        </ul>
      </section>
      <section>
        <h2 className="text-sm font-semibold text-slate-300">Audit</h2>
        <ul className="mt-2 space-y-1 text-sm">
          {data.audits.map((row, index) => <li key={index}>{row.nurse_id} · {row.action}{row.on_time == null ? "" : row.on_time ? " · on time" : " · late"}</li>)}
        </ul>
      </section>
    </div>
  );
}
