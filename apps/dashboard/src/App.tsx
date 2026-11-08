import { useEffect, useState } from "react";
import { Link, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { NURSES, nurseId, setNurseId } from "./api";
import { Checkin } from "./pages/Checkin";
import { Enroll } from "./pages/Enroll";
import { PatientPage } from "./pages/Patient";
import { Ward } from "./pages/Ward";
import logoUrl from "../../../logo.jpeg";

export function App() {
  const [nurse, setNurse] = useState(nurseId());
  const location = useLocation();
  const patientFacing = location.pathname.startsWith("/checkin/");
  useEffect(() => setNurseId(nurse), [nurse]);

  return (
    <div className="min-h-screen">
      {!patientFacing && (
        <header className="fixed inset-x-0 top-0 z-30 border-b border-line bg-ink/95 backdrop-blur">
          <div className="mx-auto flex h-14 max-w-6xl items-center gap-8 px-6">
            <Link to="/" className="flex items-center gap-2 font-semibold">
              <img src={logoUrl} alt="" className="h-8 w-8 rounded object-cover" />
              <span>WaitWatch</span>
            </Link>
            <nav className="flex gap-5 text-sm">
              <NavItem to="/" end>Monitor</NavItem>
              <NavItem to="/enroll">Enroll</NavItem>
            </nav>
            <label className="ml-auto flex items-center gap-2 text-sm text-fg-muted">
              Nurse
              <select
                className="rounded-md border border-line bg-panel px-2 py-1 text-sm text-fg outline-none focus:border-fg-muted"
                value={nurse}
                onChange={(event) => setNurse(event.target.value)}
              >
                {NURSES.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
              </select>
            </label>
          </div>
        </header>
      )}
      <main className={patientFacing ? "" : "pt-14"}>
        <Routes>
          <Route path="/" element={<Ward />} />
          <Route path="/enroll" element={<Enroll />} />
          <Route path="/patients/:id" element={<PatientPage />} />
          <Route path="/checkin/:code" element={<Checkin />} />
        </Routes>
      </main>
    </div>
  );
}

function NavItem({ to, end, children }: { to: string; end?: boolean; children: string }) {
  return (
    <NavLink to={to} end={end} className={({ isActive }) => (isActive ? "text-fg" : "text-fg-muted hover:text-fg")}>
      {children}
    </NavLink>
  );
}
