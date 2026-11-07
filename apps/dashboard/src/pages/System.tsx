import { useEffect, useRef, useState } from "react";
import { api } from "../api";

type Snapshot = {
  mode: string;
  uptimeSec: number;
  ingestRequests: number;
  ingestReadings: number;
  readingsPerSec: number;
  p95IngestMs: number | null;
  p95ProcessLagMs: number | null;
  p95AlertMs: number | null;
  prompts: number;
  busDepth: number;
  workers: number;
  iteratorAgeMs: number;
  targetAlertMs: number;
};

export function SystemPage() {
  const [local, setLocal] = useState<Snapshot | null>(null);
  const [workers, setWorkers] = useState(1);
  const seeded = useRef(false);

  async function load() {
    const body = await api<{ local: Snapshot }>("/api/system");
    setLocal(body.local);
    if (!seeded.current) {
      seeded.current = true;
      setWorkers(body.local.workers);
    }
  }

  useEffect(() => {
    load().catch(() => undefined);
    const timer = setInterval(() => load().catch(() => undefined), 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="space-y-4 p-6">
      <h1 className="text-xl font-semibold">Scale</h1>
      <p className="max-w-2xl text-sm text-slate-400">
        Devices post 5-second batches. Ingest returns 202 and the buffer absorbs spikes. Workers are stateless: live state is in DynamoDB on AWS, and history is Aurora with daily partitions and 1-minute rollups. This page is the local stand-in. On AWS the same numbers come from CloudWatch, and worker count is the ECS desired count.
      </p>
      {local && (
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Mode" value={local.mode} />
          <Stat label="Ingest requests" value={String(local.ingestRequests)} />
          <Stat label="Readings / sec" value={local.readingsPerSec.toFixed(1)} />
          <Stat label="p95 ingest" value={local.p95IngestMs == null ? "—" : `${local.p95IngestMs} ms`} />
          <Stat label="p95 alert" value={local.p95AlertMs == null ? "—" : `${local.p95AlertMs} ms`} />
          <Stat label="Buffer depth" value={String(local.busDepth)} />
          <Stat label="Workers" value={String(local.workers)} />
          <Stat label="Prompts" value={String(local.prompts)} />
          <Stat label="Iterator age" value={`${local.iteratorAgeMs} ms`} />
        </div>
      )}
      <form className="flex items-center gap-2" onSubmit={async (event) => {
        event.preventDefault();
        await api("/api/system/workers", { method: "POST", body: JSON.stringify({ count: workers }) });
        await load();
      }}>
        <label className="text-sm">Local worker concurrency
          <input className="ml-2 w-20 rounded bg-slate-800 px-2 py-1" type="number" min={1} max={32} value={workers} onChange={(e) => setWorkers(Number(e.target.value))} />
        </label>
        <button className="rounded bg-sky-700 px-3 py-1 text-sm">Apply</button>
      </form>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return <div className="rounded bg-slate-900 p-3"><div className="text-xs text-slate-400">{label}</div><div className="text-2xl font-semibold">{value}</div></div>;
}
