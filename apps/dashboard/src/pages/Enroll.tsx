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
    <form onSubmit={submit} className="mx-auto max-w-lg space-y-3 p-6">
      <h1 className="text-xl font-semibold">Enroll at triage</h1>
      <p className="text-sm text-slate-400">Only patients who need watching get a wearable: chest pain, abnormal labs, shortness of breath, or another reason you record.</p>
      {error && <p className="text-sm text-red-300">{error}</p>}
      <label className="block text-sm">Name
        <input required className="mt-1 w-full rounded bg-slate-800 px-2 py-1" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
      </label>
      <label className="block text-sm">CTAS
        <select className="mt-1 w-full rounded bg-slate-800 px-2 py-1" value={ctas} onChange={(e) => setCtas(e.target.value)}>
          {[1, 2, 3, 4, 5].map((level) => <option key={level} value={level}>{level}</option>)}
        </select>
      </label>
      <label className="block text-sm">Reason
        <select className="mt-1 w-full rounded bg-slate-800 px-2 py-1" value={reason} onChange={(e) => setReason(e.target.value)}>
          <option value="chest_pain">Chest pain</option>
          <option value="abnormal_labs">Abnormal labs</option>
          <option value="sob">Shortness of breath</option>
          <option value="other">Other</option>
        </select>
      </label>
      <label className="block text-sm">Wearable
        <select className="mt-1 w-full rounded bg-slate-800 px-2 py-1" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
          {devices.map((device) => <option key={device.id} value={device.id} disabled={device.paired}>{device.id}{device.paired ? " (in use)" : ""}</option>)}
        </select>
      </label>
      <label className="block text-sm">Official temperature °C
        <input className="mt-1 w-full rounded bg-slate-800 px-2 py-1" value={tempC} onChange={(e) => setTempC(e.target.value)} />
      </label>
      <button className="rounded bg-sky-700 px-3 py-2 text-sm">Pair device</button>
    </form>
  );
}
