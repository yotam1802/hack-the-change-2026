import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, nurseId } from "../api";

type Device = { id: string; paired: boolean };

export function Enroll() {
  const navigate = useNavigate();
  const [devices, setDevices] = useState<Device[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [complaint, setComplaint] = useState("");
  const [symptomOnset, setSymptomOnset] = useState("");
  const [ctas, setCtas] = useState("3");
  const [reason, setReason] = useState("chest_pain");
  const [deviceId, setDeviceId] = useState("device-01");
  const [tempC, setTempC] = useState("");
  const [sbp, setSbp] = useState("");
  const [dbp, setDbp] = useState("");
  const [respRate, setRespRate] = useState("");
  const [pain, setPain] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ devices: Device[] }>("/api/devices").then((body) => {
      setDevices(body.devices);
      const free = body.devices.find((device) => !device.paired);
      if (free) setDeviceId(free.id);
    }).catch((err) => setError(String(err)));
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError("");
    try {
      const vitals: Record<string, number | string> = {};
      if (tempC) {
        vitals.tempC = Number(tempC);
        vitals.tempMethod = "oral";
      }
      if (sbp) vitals.sbp = Number(sbp);
      if (dbp) vitals.dbp = Number(dbp);
      if (respRate) vitals.respRate = Number(respRate);
      if (pain !== "") vitals.pain = Number(pain);
      await api("/api/enrollments", {
        method: "POST",
        body: JSON.stringify({
          displayName,
          complaint: complaint || undefined,
          symptomOnset: symptomOnset || undefined,
          ctas: Number(ctas),
          enrollmentReason: reason,
          deviceId,
          nurseId: nurseId(),
          roomTempC: 22,
          vitals: Object.keys(vitals).length ? vitals : undefined,
        }),
      });
      navigate("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <h1 className="text-xl font-semibold">Enroll Patients</h1>
      <p className="mt-1 text-base text-fg-muted">For patients who need watching while they wait: chest pain, abnormal labs, shortness of breath, or another reason you record.</p>
      <form onSubmit={submit} className="mt-6 grid gap-5 md:grid-cols-2">
        {error && <p className="whitespace-pre-line text-sm text-red-300 md:col-span-2">{error}</p>}
        <label className="field md:col-span-2">Name
          <input required autoFocus className="input h-12 border-fg-faint text-base" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </label>
        <label className="field md:col-span-2">Brief complaint
          <textarea className="input min-h-32 resize-y border-fg-faint text-base" maxLength={500} value={complaint} onChange={(e) => setComplaint(e.target.value)} placeholder="What is the patient experiencing?" />
        </label>
        <label className="field md:col-span-2">Symptom onset
          <input className="input h-12 border-fg-faint text-base" maxLength={120} value={symptomOnset} onChange={(e) => setSymptomOnset(e.target.value)} placeholder="When did it start?" />
        </label>
        <label className="field">CTAS
          <select className="input h-12 border-fg-faint text-base" value={ctas} onChange={(e) => setCtas(e.target.value)}>
            {[1, 2, 3, 4, 5].map((level) => <option key={level} value={level}>{level}</option>)}
          </select>
        </label>
        <label className="field">Temperature °C
          <input className="input h-12 border-fg-faint text-base" inputMode="decimal" type="number" step="0.1" value={tempC} onChange={(e) => setTempC(e.target.value)} />
        </label>
        <label className="field">Systolic BP
          <input className="input h-12 border-fg-faint text-base" inputMode="numeric" type="number" value={sbp} onChange={(e) => setSbp(e.target.value)} />
        </label>
        <label className="field">Diastolic BP
          <input className="input h-12 border-fg-faint text-base" inputMode="numeric" type="number" value={dbp} onChange={(e) => setDbp(e.target.value)} />
        </label>
        <label className="field">Respiratory rate
          <input className="input h-12 border-fg-faint text-base" inputMode="numeric" type="number" value={respRate} onChange={(e) => setRespRate(e.target.value)} />
        </label>
        <label className="field">Pain (0–10)
          <input className="input h-12 border-fg-faint text-base" inputMode="numeric" type="number" min="0" max="10" value={pain} onChange={(e) => setPain(e.target.value)} />
        </label>
        <label className="field">Reason
          <select className="input h-12 border-fg-faint text-base" value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="chest_pain">Chest pain</option>
            <option value="abnormal_labs">Abnormal labs</option>
            <option value="sob">Shortness of breath</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="field">Wearable
          <select className="input h-12 border-fg-faint text-base" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
            {devices.map((device) => <option key={device.id} value={device.id} disabled={device.paired}>{device.id}{device.paired ? " (in use)" : ""}</option>)}
          </select>
        </label>
        <button className="btn btn-primary h-12 text-base md:col-span-2">Start monitoring</button>
      </form>
    </div>
  );
}
