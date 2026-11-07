import { useEffect, useState, type ChangeEvent } from "react";
import { Link } from "react-router-dom";
import { CTAS_LABEL, CTAS_REASSESS_MS, REASON_LABEL, type PatientView, type PromptView } from "@waitwatch/shared";
import { api, formatRemaining, nurseId, worstSeverity, type BoardResponse } from "../api";
import { CTAS_RAIL, CtasChip, SeverityDot } from "../ui";

export function Ward() {
  const [patients, setPatients] = useState<PatientView[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
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
  const withPrompts = patients.filter((patient) => patient.openPrompts.length > 0).length;
  const overdue = patients.filter((patient) => now > patient.nextReassessAt).length;

  return (
    <div className="mx-auto grid max-w-[1600px] gap-6 p-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <section>
        <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Waiting room</h1>
            <p className="mt-1 text-sm text-fg-muted">Ordered by CTAS, then arrival. Prompts never move anyone.</p>
          </div>
          <div className="flex gap-2">
            <Stat label="Waiting" value={patients.length} />
            <Stat label="Prompts" value={withPrompts} tone={withPrompts ? "rose" : undefined} />
            <Stat label="Overdue" value={overdue} tone={overdue ? "amber" : undefined} />
          </div>
        </div>
        {error && <p className="mb-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{error}</p>}
        {patients.length === 0 && !error && (
          <div className="card p-10 text-center text-sm text-fg-muted">
            No one is enrolled. <Link className="text-sky-300 hover:underline" to="/enroll">Pair a wearable</Link> to start monitoring.
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-3">
          {patients.map((patient) => (
            <PatientTile key={patient.id} patient={patient} now={now} selected={patient.id === selected} onSelect={() => setSelected(patient.id)} />
          ))}
        </div>
      </section>
      <Drawer patient={current} onChanged={load} onClose={() => setSelected(null)} />
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "rose" | "amber" }) {
  const color = tone === "rose" ? "text-rose-300" : tone === "amber" ? "text-amber-300" : "text-fg";
  return (
    <div className="card min-w-[88px] px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-fg-faint">{label}</div>
      <div className={`text-xl font-semibold tabular-nums leading-tight ${color}`}>{value}</div>
    </div>
  );
}

function PatientTile({ patient, now, selected, onSelect }: { patient: PatientView; now: number; selected: boolean; onSelect: () => void }) {
  const severity = worstSeverity(patient.openPrompts);
  const bpm = patient.latest?.bpm ?? null;
  const overdue = now > patient.nextReassessAt;
  const interval = CTAS_REASSESS_MS[patient.ctas];
  const elapsed = Math.min(1, Math.max(0, 1 - (patient.nextReassessAt - now) / interval));
  const grouped = groupPrompts(patient.openPrompts);
  const top = grouped[0]?.prompt;

  return (
    <button
      onClick={onSelect}
      className={`card relative overflow-hidden p-4 text-left transition hover:border-fg-faint/50 ${selected ? "ring-2 ring-sky-400/70" : ""} ${severity === "urgent" ? "urgent-tile" : ""}`}
    >
      <span className={`absolute inset-y-0 left-0 w-1 ${CTAS_RAIL[patient.ctas]}`} />
      <div className="flex items-center justify-between gap-3 pl-2">
        <span className="truncate font-medium">{patient.displayName}</span>
        <CtasChip level={patient.ctas} />
      </div>

      <div className="mt-4 flex items-end gap-3 pl-2">
        <span className={`text-5xl font-semibold leading-none tracking-tight tabular-nums ${bpm == null ? "text-fg-faint" : ""}`}>{bpm ?? "—"}</span>
        <div className="pb-0.5">
          <div className="text-xs text-fg-muted">bpm · {patient.latest?.activity ?? "no signal"}</div>
          <BaselineDelta bpm={bpm} baseline={patient.hrBaseline} />
        </div>
      </div>

      <dl className="mt-4 grid grid-cols-3 gap-2 pl-2">
        <Metric label="Skin" value={patient.latest?.skinTempC != null ? `${patient.latest.skinTempC.toFixed(1)}°` : "—"} hint="approx" />
        <Metric label="SpO₂" value={patient.latest?.spo2 != null ? `${patient.latest.spo2}%` : "—"} hint="sim" />
        <Metric label="Baseline" value={patient.hrBaseline.bpm ? `${Math.round(patient.hrBaseline.bpm)}` : "—"} hint="bpm" />
      </dl>

      <div className="mt-4 pl-2">
        <div className="flex items-center justify-between text-xs">
          <span className={overdue ? "font-medium text-amber-300" : "text-fg-muted"}>
            {patient.ctas === 1 ? "Continuous" : "Reassess"} · {formatRemaining(patient.nextReassessAt, now)}
          </span>
          {grouped.length > 0 && severity && (
            <span className="flex items-center gap-1.5 text-fg-muted">
              <SeverityDot severity={severity} />
              {grouped.length} {grouped.length === 1 ? "prompt" : "prompts"}
            </span>
          )}
        </div>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-line">
          <div className={`h-full rounded-full transition-[width] ${overdue ? "bg-amber-400" : "bg-fg-faint"}`} style={{ width: `${elapsed * 100}%` }} />
        </div>
      </div>

      {top && (
        <p className={`mt-3 line-clamp-2 pl-2 text-xs leading-relaxed ${top.severity === "urgent" ? "text-rose-200" : top.severity === "warning" ? "text-amber-100" : "text-fg-muted"}`}>
          {top.message}
        </p>
      )}
    </button>
  );
}

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-lg bg-panel-2 px-2.5 py-2">
      <dt className="text-[11px] text-fg-faint">{label}{hint && <span className="ml-1 opacity-70">{hint}</span>}</dt>
      <dd className="text-sm font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function BaselineDelta({ bpm, baseline }: { bpm: number | null; baseline: PatientView["hrBaseline"] }) {
  if (bpm == null) return <div className="mt-1 text-xs text-fg-faint">Waiting for signal</div>;
  if (!baseline.bpm) {
    const text = baseline.status === "calibrating" ? "Calibrating baseline" : baseline.status === "extended" ? "Extending calibration" : "Baseline unavailable";
    return <div className="mt-1 text-xs text-fg-faint">{text}</div>;
  }
  const delta = Math.round(bpm - baseline.bpm);
  const magnitude = Math.abs(delta);
  if (magnitude <= 5) return <div className="mt-1 inline-flex rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-xs text-emerald-300">At baseline</div>;
  const tone = magnitude >= 30 ? "bg-rose-500/15 text-rose-300" : magnitude >= 15 ? "bg-amber-400/15 text-amber-200" : "bg-panel-2 text-fg-muted";
  return <div className={`mt-1 inline-flex rounded-md px-1.5 py-0.5 text-xs tabular-nums ${tone}`}>{delta > 0 ? "+" : "−"}{magnitude} vs baseline</div>;
}

const SEVERITY_RANK: Record<PromptView["severity"], number> = { urgent: 0, warning: 1, info: 2 };

/** Collapse repeated prompts of the same kind and message; keep the newest and sort by severity. */
function groupPrompts(prompts: PromptView[]) {
  const groups = new Map<string, { prompt: PromptView; count: number }>();
  for (const prompt of prompts) {
    const key = `${prompt.kind}|${prompt.message}`;
    const existing = groups.get(key);
    if (!existing) groups.set(key, { prompt, count: 1 });
    else {
      existing.count += 1;
      if (prompt.createdAt > existing.prompt.createdAt) existing.prompt = prompt;
    }
  }
  return [...groups.values()].sort((a, b) => SEVERITY_RANK[a.prompt.severity] - SEVERITY_RANK[b.prompt.severity] || b.prompt.createdAt - a.prompt.createdAt);
}

const EMPTY_VITALS = { tempC: "", sbp: "", dbp: "", resp: "", pain: "", note: "" };

function Drawer({ patient, onChanged, onClose }: { patient: PatientView | null; onChanged: () => Promise<void>; onClose: () => void }) {
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
      <aside className="card hidden h-fit p-6 text-sm text-fg-muted lg:block lg:sticky lg:top-20">
        <p className="font-medium text-fg">Select a patient</p>
        <p className="mt-1">Review open prompts, record vitals, and log a reassessment.</p>
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
    <aside className="card h-fit p-5 lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-lg font-semibold tracking-tight">{patient.displayName}</h2>
            <CtasChip level={patient.ctas} />
          </div>
          <p className="mt-1 text-xs text-fg-muted">{CTAS_LABEL[patient.ctas].split(" · ")[1]} · {REASON_LABEL[patient.enrollmentReason]} · code {patient.publicCode}</p>
        </div>
        <button aria-label="Close" className="rounded-md p-1 text-fg-faint hover:bg-panel-2 hover:text-fg" onClick={onClose}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 4l8 8M12 4l-8 8" /></svg>
        </button>
      </div>

      <section className="mt-4">
        <div className="flex items-center justify-between">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-fg-faint">Open prompts</h3>
          <Link className="text-xs text-sky-300 hover:underline" to={`/patients/${patient.id}`}>Timeline →</Link>
        </div>
        <ul className="mt-2 max-h-64 space-y-1.5 overflow-y-auto">
          {groupPrompts(patient.openPrompts).map(({ prompt, count }) => (
            <li key={prompt.id} className="rounded-lg bg-panel-2 px-3 py-2 text-sm">
              <div className="flex items-start gap-2">
                <SeverityDot severity={prompt.severity} />
                <span className="leading-snug">{prompt.message}</span>
                {count > 1 && <span className="ml-auto shrink-0 rounded-md bg-ink/60 px-1.5 py-0.5 text-[11px] tabular-nums text-fg-muted">×{count}</span>}
              </div>
              {prompt.explanation && (
                <details className="mt-1 pl-4">
                  <summary className="cursor-pointer text-xs text-fg-muted hover:text-fg">Draft note</summary>
                  <p className="mt-1 text-xs leading-relaxed text-fg-muted">{prompt.explanation}</p>
                </details>
              )}
            </li>
          ))}
          {patient.openPrompts.length === 0 && <li className="rounded-lg bg-panel-2 px-3 py-2 text-sm text-fg-muted">Nothing open.</li>}
        </ul>
      </section>

      <section className="mt-5">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-fg-faint">Vitals</h3>
        <div className="mt-2 grid grid-cols-2 gap-2">
          <label className="field">Temp °C<input className="input" inputMode="decimal" placeholder="36.8" value={form.tempC} onChange={update("tempC")} /></label>
          <label className="field">Pain 0–10<input className="input" inputMode="numeric" placeholder="0" value={form.pain} onChange={update("pain")} /></label>
          <label className="field">SBP<input className="input" inputMode="numeric" placeholder="120" value={form.sbp} onChange={update("sbp")} /></label>
          <label className="field">DBP<input className="input" inputMode="numeric" placeholder="80" value={form.dbp} onChange={update("dbp")} /></label>
          <label className="field">Resp rate<input className="input" inputMode="numeric" placeholder="16" value={form.resp} onChange={update("resp")} /></label>
          <label className="field">Re-triage to
            <select className="input mt-1" value={ctas} onChange={(e) => setCtas(e.target.value)}>
              {[1, 2, 3, 4, 5].map((level) => <option key={level} value={level}>CTAS {level}</option>)}
            </select>
          </label>
        </div>
        <textarea className="input mt-2" rows={2} placeholder="Note (optional)" value={form.note} onChange={update("note")} />
      </section>

      {error && <p className="mt-3 text-xs text-red-300">{error}</p>}

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button disabled={busy} className="btn btn-emerald col-span-2" onClick={() => act("reassessed_no_change")}>Reassessed, no change</button>
        <button disabled={busy} className="btn btn-amber" onClick={() => act("retriage")}>Re-triage</button>
        <button disabled={busy} className="btn btn-primary" onClick={() => act("call_to_treatment")}>Call to treatment</button>
        <button disabled={busy} className="btn btn-ghost" onClick={() => act("reset_baseline")}>Reset baseline</button>
        <button disabled={busy} className="btn btn-ghost" onClick={() => act("sensor_issue")}>Sensor issue</button>
      </div>
    </aside>
  );
}
