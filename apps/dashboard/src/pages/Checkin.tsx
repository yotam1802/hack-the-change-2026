import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";

export function Checkin() {
  const { code = "" } = useParams();
  const [message, setMessage] = useState("Loading…");
  const [name, setName] = useState("");
  const [pain, setPain] = useState(4);
  const [sent, setSent] = useState("");

  useEffect(() => {
    fetch(`/api/public/patients/${code}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("Code not found");
        return res.json();
      })
      .then((body) => {
        setName(body.displayName);
        setMessage(body.message);
      })
      .catch(() => setMessage("We could not find that code. Ask the triage nurse."));
  }, [code]);

  async function send(feelWorse: boolean) {
    const res = await fetch("/api/public/reports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, pain, feelWorse }),
    });
    setSent(res.ok ? "Sent to the waiting-room nurse." : "Could not send. Please tell a nurse.");
  }

  return (
    <div className="mx-auto max-w-md space-y-4 p-6">
      <h1 className="text-xl font-semibold">{name ? `Hello ${name}` : "Your visit"}</h1>
      <p>{message}</p>
      <label className="block text-sm">Pain right now: {pain}
        <input className="mt-1 w-full" type="range" min={0} max={10} value={pain} onChange={(e) => setPain(Number(e.target.value))} />
      </label>
      <div className="flex gap-2">
        <button className="rounded bg-sky-700 px-3 py-2 text-sm" onClick={() => send(false)}>Send pain score</button>
        <button className="rounded bg-amber-700 px-3 py-2 text-sm" onClick={() => send(true)}>I feel worse</button>
      </div>
      {sent && <p className="text-sm text-emerald-300">{sent}</p>}
    </div>
  );
}
