import { useEffect, useState } from "react";
import { Link, NavLink, Route, Routes } from "react-router-dom";
import { NURSES, nurseId, setNurseId } from "./api";
import { Checkin } from "./pages/Checkin";
import { Enroll } from "./pages/Enroll";
import { PatientPage } from "./pages/Patient";
import { QiPage } from "./pages/Qi";
import { SystemPage } from "./pages/System";
import { Ward } from "./pages/Ward";

export function App() {
  const [nurse, setNurse] = useState(nurseId());
  useEffect(() => setNurseId(nurse), [nurse]);
  return (
    <div className="min-h-screen">
      <header className="flex flex-wrap items-center gap-4 border-b border-white/10 px-5 py-3">
        <Link to="/" className="text-lg font-semibold tracking-tight">WaitWatch</Link>
        <span className="text-sm text-slate-400">Dartmouth General · waiting room</span>
        <nav className="flex gap-3 text-sm">
          <NavLink to="/" end className="text-slate-300">Monitor</NavLink>
          <NavLink to="/enroll" className="text-slate-300">Enroll</NavLink>
          <NavLink to="/qi" className="text-slate-300">Quality</NavLink>
          <NavLink to="/system" className="text-slate-300">System</NavLink>
        </nav>
        <label className="ml-auto text-sm text-slate-400">
          Nurse
          <select className="ml-2 rounded bg-slate-800 px-2 py-1 text-slate-100" value={nurse} onChange={(event) => setNurse(event.target.value)}>
            {NURSES.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
          </select>
        </label>
      </header>
      <p className="bg-amber-950/40 px-5 py-2 text-xs text-amber-100">Not a medical device. Nurses keep CTAS priority. Monitoring only prompts a reassessment.</p>
      <Routes>
        <Route path="/" element={<Ward />} />
        <Route path="/enroll" element={<Enroll />} />
        <Route path="/patients/:id" element={<PatientPage />} />
        <Route path="/qi" element={<QiPage />} />
        <Route path="/system" element={<SystemPage />} />
        <Route path="/checkin/:code" element={<Checkin />} />
      </Routes>
    </div>
  );
}
