import { useEffect, useState } from "react";
import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { NURSES, nurseId, setNurseId } from "./api";
import { Checkin } from "./pages/Checkin";
import { Enroll } from "./pages/Enroll";
import { PatientPage } from "./pages/Patient";
import { Ward } from "./pages/Ward";

export function App() {
  const [nurse, setNurse] = useState(nurseId());
  const location = useLocation();
  const patientFacing = location.pathname.startsWith("/checkin/");
  useEffect(() => setNurseId(nurse), [nurse]);

  return (
    <div className="min-h-screen">
      {!patientFacing && (
        <header className="sticky top-0 z-20 border-b border-line bg-ink/85 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-6 px-6">
            <Link to="/" className="flex items-center gap-2.5">
              <span className="live-dot h-2.5 w-2.5 rounded-full bg-sky-400 shadow-[0_0_12px_rgba(56,189,248,0.8)]" />
              <span className="font-semibold tracking-tight">WaitWatch</span>
            </Link>
            <nav className="flex items-center gap-1 rounded-lg bg-panel p-1 text-sm">
              <NavItem to="/" end>Monitor</NavItem>
              <NavItem to="/enroll">Enroll</NavItem>
            </nav>
            <span className="ml-auto hidden text-xs text-fg-faint md:inline">Not a medical device · nurses keep CTAS priority</span>
            <select
              aria-label="Nurse"
              className="rounded-lg border border-line bg-panel px-2.5 py-1.5 text-sm text-fg outline-none focus:border-sky-500/60"
              value={nurse}
              onChange={(event) => setNurse(event.target.value)}
            >
              {NURSES.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
            </select>
          </div>
        </header>
      )}
      <Routes>
        <Route path="/" element={<Ward />} />
        <Route path="/enroll" element={<Enroll />} />
        <Route path="/patients/:id" element={<PatientPage />} />
        <Route path="/checkin/:code" element={<Checkin />} />
      </Routes>
    </div>
  );
}

function NavItem({ to, end, children }: { to: string; end?: boolean; children: string }) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) => `rounded-md px-3 py-1.5 transition ${isActive ? "bg-panel-2 text-fg" : "text-fg-muted hover:text-fg"}`}
    >
      {children}
    </NavLink>
  );
}
