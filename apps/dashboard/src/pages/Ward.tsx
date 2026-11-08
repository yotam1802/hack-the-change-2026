import { useEffect, useState, type ChangeEvent } from "react";
import { Link } from "react-router-dom";
import { CTAS_LABEL, REASON_LABEL, type PatientView, type PromptView } from "@waitwatch/shared";
import { api, nurseId, getSessionToken, type BoardResponse } from "../api";
import { CTAS_COLOR, CtasLabel } from "../ui";

type LiveMessage = {
  type: string;
  patients?: PatientView[];
  prompt?: PromptView;
  patientId?: string;
  latest?: PatientView["latest"];
  hrBaseline?: PatientView["hrBaseline"];
};
function applySnapshot(current: PatientView[], incoming: PatientView[]) {
  const previous = new Map(current.map((patient) => [patient.id, patient]));
  return incoming.map((patient) => {
    const prior = previous.get(patient.id);
    if (!prior?.latest) return patient;
    if (!patient.latest || patient.latest.ts < prior.latest.ts) {
      return { ...patient, latest: prior.latest, hrBaseline: prior.hrBaseline };
    }
    return patient;
  });
}
function applyHeartRate(current: PatientView[], message: LiveMessage) {
  if (!message.patientId || !message.latest) return current;
  const latest = message.latest;
  return current.map((patient) => {
    if (patient.id !== message.patientId) return patient;
    if (patient.latest && latest.ts < patient.latest.ts) return patient;
    return { ...patient, latest, hrBaseline: message.hrBaseline ?? patient.hrBaseline };
  });
}
export function Ward() {
  const [patients, setPatients] = useState<PatientView[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState("");
  // Dismissing a popup does not acknowledge or clear its underlying alert.
  const [alertDismissedUntil, setAlertDismissedUntil] = useState(0);

  useEffect(() => {
    if (!alertDismissedUntil) return;
    const timer = window.setTimeout(
      () => setAlertDismissedUntil(0),
      Math.max(0, alertDismissedUntil - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [alertDismissedUntil]);
  async function load() {
    const board = await api<BoardResponse>("/api/board");
    setPatients((current) => applySnapshot(current, board.patients));
  }
  useEffect(() => {
    load().catch((err) => setError(String(err)));
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const socket = new WebSocket(`${proto}://${location.host}/ws`);

    socket.onopen = () => {
      const token = getSessionToken();
      if (token) socket.send(JSON.stringify({ type: "auth", token }));
      else socket.send(JSON.stringify({ type: "subscribe", unitId: "ed-waiting" })); // explicit local demo mode only
    };

    socket.onmessage = (event) => {
      const body = JSON.parse(event.data) as LiveMessage;
      if (body.type === "auth_ok") {
        socket.send(JSON.stringify({ type: "subscribe", unitId: "ed-waiting" }));
        return;
      }
      if (body.type === "snapshot" && body.patients) {
        const incoming = body.patients;
        setPatients((current) => applySnapshot(current, incoming));
      }
      if (body.type === "heart_rate") setPatients((current) => applyHeartRate(current, body));
      if (body.type === "prompt") load().catch(() => undefined);
    };
    return () => socket.close();
  }, []);
  const current = patients.find((patient) => patient.id === selected) ?? null;
  const alertPatients = patients.filter(
    (patient) =>
      (patient.latest?.bpm ?? 0) >= 120 ||
      patient.openPrompts.some(
        (prompt) =>
          ["ai_serious_vital", "high_bpm_static"].includes(prompt.kind) &&
          prompt.severity === "urgent" && !prompt.ackedAt,
      ),
  );
  return (
    <div className="grid w-full gap-6 px-6 py-8 lg:grid-cols-[minmax(0,1fr)_320px] lg:pl-56">
      {alertPatients.length > 0 && alertDismissedUntil === 0 && (
        <aside
          aria-live="assertive"
          aria-label="High heart rate alerts"
          className="fixed right-4 top-20 z-50 w-80 rounded-lg border border-red-500 bg-black p-4 text-white shadow-lg shadow-red-950/40"
        >
          <div className="flex items-start justify-between gap-3">
            <h2 className="font-semibold text-red-400">High heart rate alert</h2>
            <button
              type="button"
              aria-label="Dismiss alert popup for 15 seconds"
              title="Dismiss for 15 seconds"
              className="-mr-1 -mt-1 rounded p-1 text-white/70 hover:bg-red-950 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-white"
              onClick={() => setAlertDismissedUntil(Date.now() + 15_000)}
            >
              <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <path d="M4 4l10 10M14 4L4 14" />
              </svg>
            </button>
          </div>
          <div className="mt-2 grid gap-2">
            {alertPatients.map((patient) => {
              const alert = patient.openPrompts.find(
                (prompt) => ["ai_serious_vital", "high_bpm_static"].includes(prompt.kind) && prompt.severity === "urgent" && !prompt.ackedAt,
              );
              const isHighBpm = (patient.latest?.bpm ?? 0) >= 120;
              return (
                <button
                  key={patient.id}
                  className="rounded border border-red-500/50 bg-black px-3 py-2 text-left text-sm hover:border-red-400 hover:bg-red-950/50"
                  onClick={() => setSelected(patient.id)}
                >
                  <span className="font-medium">{patient.displayName}</span>
                  <span className="ml-2 font-semibold text-red-400">{isHighBpm ? "Static alert" : "AI alert"}</span>
                  <span className="mt-1 block text-xs text-red-200">
                    {isHighBpm
                      ? `Heart rate is ${patient.latest?.bpm} BPM, at or above the 120 BPM safety threshold.`
                      : alert?.message}
                  </span>
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-xs text-red-300">Verify the patient and reassess clinically.</p>
        </aside>
      )}
      <Legend />
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
      </section>
      <Panel patient={current} onChanged={load} onClose={() => setSelected(null)} />
    </div>
  );
}
function Legend() {
  const ctas = [
    [1, "Resuscitation"],
    [2, "Emergent"],
    [3, "Urgent"],
    [4, "Less urgent"],
    [5, "Non-urgent"],
  ] as const;
  const severities = [
    ["#6b7480", "Info", "Informational prompt"],
    ["#facc15", "Warning", "Needs attention"],
    ["#f87171", "Urgent", "Priority prompt"],
  ] as const;
  return (
    <aside aria-label="Color legend" className="card h-fit p-3 lg:fixed lg:left-4 lg:top-20 lg:z-20 lg:w-44">
      <h2 className="text-xs font-semibold uppercase tracking-wider text-fg-faint">Legend</h2>
      <div className="mt-3 grid gap-4">
        <div>
          <h3 className="mb-2 text-xs font-medium text-fg">CTAS priority</h3>
          <ul className="space-y-1.5 text-xs text-fg-muted">
            {ctas.map(([level, label]) => (
              <li key={level} className="flex items-center gap-1.5">
                <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-sm" style={{ background: CTAS_COLOR[level] }} />
                <span>{level} <span className="text-fg-faint">{label}</span></span>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="mb-2 text-xs font-medium text-fg">Prompt severity</h3>
          <ul className="space-y-1.5 text-xs text-fg-muted">
            {severities.map(([color, label, description]) => (
              <li key={label} className="flex items-center gap-1.5">
                <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: color }} />
                <span>{label}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </aside>
  );
}
function PatientCard({ patient, selected, onSelect }: { patient: PatientView; selected: boolean; onSelect: () => void }) {
  const reading = patient.latest;
  // Python now sends a sensor-derived filtered BPM. Never randomize it here.
  const bpm = reading?.bpm ?? null;
  const isArduino = patient.deviceId === "device-08";
  const min = reading?.bpmMin;
  const max = reading?.bpmMax;
  const hasRange = isArduino && min != null && max != null && min <= max;
  const skin = reading?.skinTempC;
  const spo2 = reading?.spo2;
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
      {hasRange && (
        <p className="mt-1 text-xs text-fg-muted">
          Filtered sensor estimate · range {min}–{max} bpm
        </p>
      )}
      <p className="mt-1.5 text-sm">
        <HeartRateNote bpm={bpm} baseline={patient.hrBaseline} activity={reading?.activity} />
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
      {error && <p className="mt-3 whitespace-pre-line text-sm text-red-300">{error}</p>}
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
