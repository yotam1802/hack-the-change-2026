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
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center p-6">
      <div className="card p-6">
        <h1 className="text-2xl font-semibold tracking-tight">{name ? `Hello ${name}` : "Your visit"}</h1>
        <p className="mt-2 text-sm leading-relaxed text-fg-muted">{message}</p>
        <div className="mt-6">
          <div className="flex items-baseline justify-between">
            <span className="text-sm font-medium">Pain right now</span>
            <span className="text-3xl font-semibold tabular-nums">{pain}<span className="text-sm text-fg-faint"> / 10</span></span>
          </div>
          <input className="mt-2 w-full accent-sky-400" type="range" min={0} max={10} value={pain} onChange={(e) => setPain(Number(e.target.value))} />
        </div>
        <div className="mt-6 grid grid-cols-2 gap-2">
          <button className="btn btn-primary py-3" onClick={() => send(false)}>Send pain score</button>
          <button className="btn btn-amber py-3" onClick={() => send(true)}>I feel worse</button>
        </div>
        {sent && <p className="mt-4 text-center text-sm text-emerald-300">{sent}</p>}
      </div>
    </div>
  );
}
