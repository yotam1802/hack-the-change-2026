import { useEffect, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, nurseId } from "../api";

type Device = { id: string; paired: boolean };

export function Enroll() {
  const navigate = useNavigate();
  const [devices, setDevices] = useState<Device[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [ctas, setCtas] = useState("3");
  const [reason, setReason] = useState("chest_pain");
  const [deviceId, setDeviceId] = useState("device-01");
  const [tempC, setTempC] = useState("36.8");
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
      await api("/api/enrollments", {
        method: "POST",
        body: JSON.stringify({
          displayName,
          ctas: Number(ctas),
          enrollmentReason: reason,
          deviceId,
          nurseId: nurseId(),
          roomTempC: 22,
          vitals: { tempC: Number(tempC), tempMethod: "oral", pain: 0 },
        }),
      });
      navigate("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="mx-auto max-w-md px-6 py-8">
      <h1 className="text-xl font-semibold">Enroll a patient</h1>
      <p className="mt-1 text-sm text-fg-muted">For patients who need watching while they wait: chest pain, abnormal labs, shortness of breath, or another reason you record.</p>
      <form onSubmit={submit} className="mt-6 space-y-4">
        {error && <p className="whitespace-pre-line text-sm text-red-300">{error}</p>}
        <label className="field">Name
          <input required autoFocus className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
        </label>
        <div className="grid grid-cols-2 gap-3">
          <label className="field">CTAS
            <select className="input mt-1" value={ctas} onChange={(e) => setCtas(e.target.value)}>
              {[1, 2, 3, 4, 5].map((level) => <option key={level} value={level}>{level}</option>)}
            </select>
          </label>
          <label className="field">Temperature °C
            <input className="input" inputMode="decimal" value={tempC} onChange={(e) => setTempC(e.target.value)} />
          </label>
        </div>
        <label className="field">Reason
          <select className="input mt-1" value={reason} onChange={(e) => setReason(e.target.value)}>
            <option value="chest_pain">Chest pain</option>
            <option value="abnormal_labs">Abnormal labs</option>
            <option value="sob">Shortness of breath</option>
            <option value="other">Other</option>
          </select>
        </label>
        <label className="field">Wearable
          <select className="input mt-1" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
            {devices.map((device) => <option key={device.id} value={device.id} disabled={device.paired}>{device.id}{device.paired ? " (in use)" : ""}</option>)}
          </select>
        </label>
        <button className="btn btn-primary mt-2">Start monitoring</button>
      </form>
    </div>
  );
}
