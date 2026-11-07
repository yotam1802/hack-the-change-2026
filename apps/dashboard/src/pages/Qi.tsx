import { useEffect, useState } from "react";
import { api, nurseId } from "../api";

type Qi = {
  eventsByKind: Array<{ kind: string; count: number }>;
  medianAckMs: number | null;
  compliance: number | null;
  reassessmentsOnTime: number;
  reassessmentsLate: number;
  devicesInUse: number;
  overdue: number;
  waiting: number;
  surveys: Array<{ role: string; average: number; count: number }>;
};

export function QiPage() {
  const [data, setData] = useState<Qi | null>(null);
  const [score, setScore] = useState("5");
  const [comment, setComment] = useState("");
  const [saved, setSaved] = useState(false);

  function load() {
    api<Qi>("/api/qi").then(setData).catch(() => undefined);
  }
  useEffect(load, []);

  return (
    <div className="space-y-4 p-6">
      <h1 className="text-xl font-semibold">Quality improvement</h1>
      {!data && <p className="text-slate-400">Loading…</p>}
      {data && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Waiting" value={String(data.waiting)} />
          <Stat label="Devices in use" value={String(data.devicesInUse)} />
          <Stat label="Overdue reassessments" value={String(data.overdue)} />
          <Stat label="Median time to acknowledge" value={data.medianAckMs == null ? "—" : `${Math.round(data.medianAckMs / 1000)}s`} />
          <Stat label="Reassessments on time" value={data.compliance == null ? "—" : `${Math.round(data.compliance * 100)}%`} />
          <Stat label="On time / late" value={`${data.reassessmentsOnTime} / ${data.reassessmentsLate}`} />
        </div>
      )}
      {data && (
        <ul className="text-sm">
          {data.eventsByKind.map((row) => <li key={row.kind}>{row.kind}: {row.count}</li>)}
          {data.surveys.map((row) => <li key={row.role}>{row.role} satisfaction {row.average.toFixed(1)} / 5 ({row.count})</li>)}
        </ul>
      )}
      <form className="max-w-md space-y-2" onSubmit={async (event) => {
        event.preventDefault();
        await api("/api/surveys", { method: "POST", body: JSON.stringify({ role: "staff", score: Number(score), comment }) });
        setSaved(true);
        load();
      }}>
        <h2 className="text-sm font-semibold">Staff survey</h2>
        <p className="text-xs text-slate-400">Signed in as {nurseId()}.</p>
        <select className="rounded bg-slate-800 px-2 py-1" value={score} onChange={(e) => setScore(e.target.value)}>
          {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <input className="w-full rounded bg-slate-800 px-2 py-1" placeholder="Comment" value={comment} onChange={(e) => setComment(e.target.value)} />
        <button className="rounded bg-sky-700 px-3 py-1 text-sm">Submit</button>
        {saved && <p className="text-sm text-emerald-300">Saved.</p>}
      </form>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-slate-900 p-3">
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-2xl font-semibold">{value}</div>
    </div>
  );
}
