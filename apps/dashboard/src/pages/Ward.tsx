import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CTAS_LABEL, REASON_LABEL, type PatientView, type PromptView } from "@waitwatch/shared";
import { api, formatRemaining, nurseId, worstSeverity, type BoardResponse } from "../api";

const CTAS_BAR: Record<number, string> = {
  1: "border-l-red-500",
  2: "border-l-orange-500",
  3: "border-l-amber-400",
  4: "border-l-emerald-500",
  5: "border-l-sky-500",
};

export function Ward() {
  const [patients, setPatients] = useState<PatientView[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  const [handoff, setHandoff] = useState("");
  const [error, setError] = useState("");

  async function load() {
    const board = await api<BoardResponse>("/api/board");
    setPatients(board.patients);
  }

  useEffect(() => {
    load().catch((err) => setError(String(err)));
    const clock = setInterval(() => setNow(Date.now()), 1000);
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${proto}://${location.host}/ws`);
    socket.onopen = () => socket.send(JSON.stringify({ type: "subscribe", unitId: "ed-waiting" }));
    socket.onmessage = (event) => {
      const body = JSON.parse(event.data) as { type: string; patients?: PatientView[]; prompt?: PromptView };
      if (body.type === "snapshot" && body.patients) setPatients(body.patients);
      if (body.type === "prompt") load().catch(() => undefined);
    };
    return () => {
      clearInterval(clock);
      socket.close();
    };
  }, []);

  const current = patients.find((patient) => patient.id === selected) ?? null;

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-[1fr_360px]">
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-xl font-semibold">Waiting-room monitor</h1>
          <button className="rounded bg-sky-700 px-3 py-1.5 text-sm" onClick={() => requestHandoff(setHandoff)}>Shift handoff</button>
        </div>
        {error && <p className="mb-2 text-sm text-red-300">{error}</p>}
        {handoff && <pre className="mb-3 whitespace-pre-wrap rounded bg-slate-900 p-3 text-sm text-slate-200">{handoff}</pre>}
        {patients.length === 0 && <p className="text-slate-400">No one is enrolled. Pair a wearable from the Enroll page.</p>}
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {patients.map((patient) => {
            const severity = worstSeverity(patient.openPrompts);
            return (
              <button
                key={patient.id}
                onClick={() => setSelected(patient.id)}
                className={`rounded-lg border border-white/10 border-l-4 bg-slate-900/80 p-3 text-left ${CTAS_BAR[patient.ctas]} ${severity === "urgent" ? "urgent-tile" : ""}`}
              >
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-medium">{patient.displayName}</span>
                  <span className="text-xs text-slate-400">CTAS {patient.ctas}</span>
                </div>
                <div className="mt-2 flex items-end justify-between">
                  <div>
                    <div className="text-3xl font-semibold tabular-nums">{patient.latest?.bpm ?? "—"}</div>
                    <div className="text-xs text-slate-400">bpm · {patient.latest?.activity ?? "no signal"}</div>
                  </div>
                  <div className="text-right text-xs text-slate-300">
                    <div>Skin {patient.latest?.skinTempC?.toFixed(1) ?? "—"}°C approx</div>
                    <div>SpO2 {patient.latest?.spo2 ?? "—"} SIM</div>
                    <div>Baseline {patient.hrBaseline.bpm ? Math.round(patient.hrBaseline.bpm) : patient.hrBaseline.status}</div>
                  </div>
                </div>
                <div className={`mt-2 text-xs ${now > patient.nextReassessAt ? "text-amber-300" : "text-slate-400"}`}>
                  {patient.ctas === 1 ? "Continuous · " : "Reassess · "}{formatRemaining(patient.nextReassessAt, now)}
                </div>
                {patient.openPrompts.length > 0 && (
                  <div className="mt-2 text-xs text-rose-200">{patient.openPrompts[0].message}</div>
                )}
              </button>
            );
          })}
        </div>
      </section>
      <Drawer patient={current} onChanged={load} />
    </div>
  );
}

async function requestHandoff(setHandoff: (text: string) => void) {
  const queued = await api<{ jobId: string }>("/api/units/ed-waiting/handoff", { method: "POST", body: "{}" });
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const job = await api<{ status: string; result: string | null }>(`/api/jobs/${queued.jobId}`);
    if (job.status === "done" && job.result) {
      setHandoff(job.result);
      return;
    }
  }
}

function Drawer({ patient, onChanged }: { patient: PatientView | null; onChanged: () => Promise<void> }) {
  const [tempC, setTempC] = useState("");
  const [sbp, setSbp] = useState("");
  const [dbp, setDbp] = useState("");
  const [resp, setResp] = useState("");
  const [pain, setPain] = useState("");
  const [ctas, setCtas] = useState("3");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (patient) setCtas(String(patient.ctas));
  }, [patient?.id]);

  if (!patient) return <aside className="rounded-lg border border-white/10 bg-slate-900/40 p-4 text-sm text-slate-400">Select a patient to reassess. Order on the board is CTAS, then arrival. Prompts do not move anyone.</aside>;

  async function act(action: string) {
    setBusy(true);
    try {
      const vitals: Record<string, number | string> = {};
      if (tempC) vitals.tempC = Number(tempC);
      if (tempC) vitals.tempMethod = "tympanic";
      if (sbp) vitals.sbp = Number(sbp);
      if (dbp) vitals.dbp = Number(dbp);
      if (resp) vitals.respRate = Number(resp);
      if (pain) vitals.pain = Number(pain);
      await api(`/api/patients/${patient!.id}/actions`, {
        method: "POST",
        body: JSON.stringify({
          nurseId: nurseId(),
          action,
          ctas: action === "retriage" ? Number(ctas) : undefined,
          note,
          vitals: Object.keys(vitals).length ? vitals : undefined,
        }),
      });
      await onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="rounded-lg border border-white/10 bg-slate-900 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold">{patient.displayName}</h2>
          <p className="text-xs text-slate-400">{CTAS_LABEL[patient.ctas]} · {REASON_LABEL[patient.enrollmentReason]}</p>
        </div>
        <Link className="text-sm text-sky-300" to={`/patients/${patient.id}`}>Timeline</Link>
      </div>
      <p className="mt-2 text-xs text-slate-500">Check-in code {patient.publicCode}</p>
      <ul className="mt-3 space-y-2">
        {patient.openPrompts.map((prompt) => (
          <li key={prompt.id} className="rounded bg-slate-800 p-2 text-sm">
            <span className="mr-2 text-xs uppercase text-slate-400">{prompt.severity}</span>
            {prompt.message}
            {prompt.explanation && <p className="mt-1 text-xs text-slate-300">{prompt.explanation}</p>}
          </li>
        ))}
        {patient.openPrompts.length === 0 && <li className="text-sm text-slate-500">No open prompts.</li>}
      </ul>
      <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
        <input className="rounded bg-slate-800 px-2 py-1" placeholder="Temp °C" value={tempC} onChange={(e) => setTempC(e.target.value)} />
        <input className="rounded bg-slate-800 px-2 py-1" placeholder="Pain 0-10" value={pain} onChange={(e) => setPain(e.target.value)} />
        <input className="rounded bg-slate-800 px-2 py-1" placeholder="SBP" value={sbp} onChange={(e) => setSbp(e.target.value)} />
        <input className="rounded bg-slate-800 px-2 py-1" placeholder="DBP" value={dbp} onChange={(e) => setDbp(e.target.value)} />
        <input className="rounded bg-slate-800 px-2 py-1" placeholder="Resp rate" value={resp} onChange={(e) => setResp(e.target.value)} />
        <select className="rounded bg-slate-800 px-2 py-1" value={ctas} onChange={(e) => setCtas(e.target.value)}>
          {[1, 2, 3, 4, 5].map((level) => <option key={level} value={level}>CTAS {level}</option>)}
        </select>
      </div>
      <textarea className="mt-2 w-full rounded bg-slate-800 px-2 py-1 text-sm" rows={2} placeholder="Note" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        <button disabled={busy} className="rounded bg-emerald-700 px-2 py-1" onClick={() => act("reassessed_no_change")}>Reassessed, no change</button>
        <button disabled={busy} className="rounded bg-amber-700 px-2 py-1" onClick={() => act("retriage")}>Re-triage</button>
        <button disabled={busy} className="rounded bg-sky-700 px-2 py-1" onClick={() => act("call_to_treatment")}>Call to treatment</button>
        <button disabled={busy} className="rounded bg-slate-700 px-2 py-1" onClick={() => act("reset_baseline")}>Reset baseline</button>
        <button disabled={busy} className="rounded bg-slate-700 px-2 py-1" onClick={() => act("sensor_issue")}>Sensor issue</button>
      </div>
    </aside>
  );
}
