import { useEffect, useState, type ChangeEvent } from "react";
import { Link } from "react-router-dom";
import { CTAS_LABEL, REASON_LABEL, type PatientView, type PromptView } from "@waitwatch/shared";
import { api, nurseId, type BoardResponse } from "../api";
import { CTAS_COLOR, CtasLabel } from "../ui";

export function Ward() {
  const [patients, setPatients] = useState<PatientView[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function load() {
    const board = await api<BoardResponse>("/api/board");
    setPatients(board.patients);
  }

  useEffect(() => {
    load().catch((err) => setError(String(err)));
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${proto}://${location.host}/ws`);
    socket.onopen = () => socket.send(JSON.stringify({ type: "subscribe", unitId: "ed-waiting" }));
    socket.onmessage = (event) => {
      const body = JSON.parse(event.data) as { type: string; patients?: PatientView[]; prompt?: PromptView };
      if (body.type === "snapshot" && body.patients) setPatients(body.patients);
      if (body.type === "prompt") load().catch(() => undefined);
    };
    return () => socket.close();
  }, []);

  const current = patients.find((patient) => patient.id === selected) ?? null;

  return (
    <div className="mx-auto grid max-w-6xl gap-8 px-6 py-8 lg:grid-cols-[minmax(0,1fr)_340px]">
      <section>
        <div className="mb-5 flex items-baseline gap-3">
          <h1 className="text-xl font-semibold">Waiting room</h1>
          {patients.length > 0 && <span className="text-sm text-fg-muted">{patients.length} {patients.length === 1 ? "patient" : "patients"}</span>}
        </div>
        {error && <p className="mb-4 text-sm text-red-300">{error}</p>}
        {patients.length === 0 && !error && (
          <p className="text-sm text-fg-muted">
            No one is being monitored. <Link className="text-fg underline underline-offset-2" to="/enroll">Enroll a patient</Link> to begin.
          </p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {patients.map((patient) => (
            <PatientCard key={patient.id} patient={patient} selected={patient.id === selected} onSelect={() => setSelected(patient.id)} />
          ))}
        </div>
        {patients.length > 0 && (
          <p className="mt-6 text-xs text-fg-faint">Skin temperature is approximate. SpO₂ is simulated in this build.</p>
        )}
      </section>
      <Panel patient={current} onChanged={load} onClose={() => setSelected(null)} />
    </div>
  );
}

function PatientCard({ patient, selected, onSelect }: { patient: PatientView; selected: boolean; onSelect: () => void }) {
  const bpm = patient.latest?.bpm ?? null;
  const skin = patient.latest?.skinTempC;
  const spo2 = patient.latest?.spo2;
  const baseline = patient.hrBaseline.bpm;

  return (
    <button
      onClick={onSelect}
      className={`card p-4 text-left ${selected ? "border-fg-muted" : "hover:border-fg-faint"}`}
      style={{ borderLeftWidth: 3, borderLeftColor: CTAS_COLOR[patient.ctas] }}
    >
      <div className="flex items-baseline justify-between gap-3">
        <span className="truncate font-medium">{patient.displayName}</span>
        <CtasLabel level={patient.ctas} className="text-fg-muted" />
      </div>

      <div className="mt-3 flex items-baseline gap-2">
        <span className={`text-4xl font-semibold leading-none tabular-nums ${bpm == null ? "text-fg-faint" : ""}`}>{bpm ?? "–"}</span>
        <span className="text-sm text-fg-muted">bpm</span>
      </div>
      <p className="mt-1.5 text-sm">
        <HeartRateNote bpm={bpm} baseline={patient.hrBaseline} activity={patient.latest?.activity} />
      </p>

      <dl className="mt-4 grid grid-cols-3 gap-2 text-sm">
        <Item label="Skin" value={skin != null ? `${skin.toFixed(1)} °C` : "–"} />
        <Item label="SpO₂" value={spo2 != null ? `${spo2}%` : "–"} />
        <Item label="Baseline" value={baseline ? `${Math.round(baseline)}` : "–"} />
      </dl>
    </button>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-fg-faint">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function HeartRateNote({ bpm, baseline, activity }: { bpm: number | null; baseline: PatientView["hrBaseline"]; activity?: string }) {
  if (bpm == null) return <span className="text-fg-faint">No signal from the wearable</span>;
  const state = activity && activity !== "rest" ? `, ${activity}` : "";
  if (!baseline.bpm) {
    const text = baseline.status === "insufficient" ? "Baseline could not be set" : "Measuring resting baseline";
    return <span className="text-fg-muted">{text}{state}</span>;
  }
  const delta = Math.round(bpm - baseline.bpm);
  const magnitude = Math.abs(delta);
  if (magnitude <= 5) return <span className="text-fg-muted">At baseline{state}</span>;
  const color = magnitude >= 30 ? "text-red-300" : magnitude >= 15 ? "text-yellow-200" : "text-fg-muted";
  return <span className={color}>{magnitude} {delta > 0 ? "above" : "below"} baseline{state}</span>;
}

const EMPTY_VITALS = { tempC: "", sbp: "", dbp: "", resp: "", pain: "", note: "" };

function Panel({ patient, onChanged, onClose }: { patient: PatientView | null; onChanged: () => Promise<void>; onClose: () => void }) {
  const [form, setForm] = useState(EMPTY_VITALS);
  const [ctas, setCtas] = useState("3");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (patient) setCtas(String(patient.ctas));
    setForm(EMPTY_VITALS);
    setError("");
  }, [patient?.id]);

  if (!patient) {
    return (
      <aside className="hidden text-sm text-fg-muted lg:block lg:pt-12">
        Select a patient to record vitals or log a reassessment.
      </aside>
    );
  }

  const update = (key: keyof typeof EMPTY_VITALS) => (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  async function act(action: string) {
    setBusy(true);
    setError("");
    try {
      const vitals: Record<string, number | string> = {};
      if (form.tempC) {
        vitals.tempC = Number(form.tempC);
        vitals.tempMethod = "tympanic";
      }
      if (form.sbp) vitals.sbp = Number(form.sbp);
      if (form.dbp) vitals.dbp = Number(form.dbp);
      if (form.resp) vitals.respRate = Number(form.resp);
      if (form.pain) vitals.pain = Number(form.pain);
      await api(`/api/patients/${patient!.id}/actions`, {
        method: "POST",
        body: JSON.stringify({
          nurseId: nurseId(),
          action,
          ctas: action === "retriage" ? Number(ctas) : undefined,
          note: form.note || undefined,
          vitals: Object.keys(vitals).length ? vitals : undefined,
        }),
      });
      await onChanged();
      setForm(EMPTY_VITALS);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="card h-fit p-5 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold">{patient.displayName}</h2>
          <p className="mt-0.5 text-sm text-fg-muted">{CTAS_LABEL[patient.ctas]} · {REASON_LABEL[patient.enrollmentReason]}</p>
          <p className="mt-0.5 text-sm text-fg-muted">
            Code {patient.publicCode} · <Link className="text-fg underline underline-offset-2" to={`/patients/${patient.id}`}>View timeline</Link>
          </p>
        </div>
        <button aria-label="Close" className="-mr-1 -mt-1 p-1 text-fg-faint hover:text-fg" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 4l8 8M12 4l-8 8" /></svg>
        </button>
      </div>

      <h3 className="mt-6 text-sm font-medium">Vitals</h3>
      <div className="mt-2 grid grid-cols-2 gap-3">
        <label className="field">Temperature °C<input className="input" inputMode="decimal" value={form.tempC} onChange={update("tempC")} /></label>
        <label className="field">Pain (0–10)<input className="input" inputMode="numeric" value={form.pain} onChange={update("pain")} /></label>
        <label className="field">Systolic<input className="input" inputMode="numeric" value={form.sbp} onChange={update("sbp")} /></label>
        <label className="field">Diastolic<input className="input" inputMode="numeric" value={form.dbp} onChange={update("dbp")} /></label>
        <label className="field">Respiratory rate<input className="input" inputMode="numeric" value={form.resp} onChange={update("resp")} /></label>
        <label className="field">CTAS
          <select className="input mt-1" value={ctas} onChange={(e) => setCtas(e.target.value)}>
            {[1, 2, 3, 4, 5].map((level) => <option key={level} value={level}>{level}</option>)}
          </select>
        </label>
      </div>
      <label className="field mt-3">Note
        <textarea className="input" rows={2} value={form.note} onChange={update("note")} />
      </label>

      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}

      <div className="mt-5 space-y-2">
        <button disabled={busy} className="btn btn-primary w-full" onClick={() => act("reassessed_no_change")}>Reassessed, no change</button>
        <div className="grid grid-cols-2 gap-2">
          <button disabled={busy} className="btn btn-secondary" onClick={() => act("retriage")}>Re-triage</button>
          <button disabled={busy} className="btn btn-secondary" onClick={() => act("call_to_treatment")}>Call to treatment</button>
        </div>
        <button disabled={busy} className="btn btn-quiet w-full" onClick={() => act("reset_baseline")}>Reset heart-rate baseline</button>
      </div>
    </aside>
  );
}
