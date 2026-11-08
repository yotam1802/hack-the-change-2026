import { Link, NavLink, Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { useNurseAuth, isLocalDemo } from "./auth/AuthProvider";
import { Checkin } from "./pages/Checkin";
import { Enroll } from "./pages/Enroll";
import { Home } from "./pages/Home";
import { Login, AuthCallback } from "./pages/Login";
import { PatientPage } from "./pages/Patient";
import { Ward } from "./pages/Ward";
import logoUrl from "../../../logo.jpeg";

function NurseOnly() {
  const { ready, authenticated, nurse } = useNurseAuth();
  const location = useLocation();
  if (!ready) return <div className="mx-auto max-w-xl p-12 text-center text-fg-muted">Verifying your nursing session…</div>;
  if (!authenticated || !nurse?.roles.includes("nurse")) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

function NurseLayout() {
  const { nurse, logout } = useNurseAuth();
  return <div className="min-h-screen">
    <header className="fixed inset-x-0 top-0 z-30 border-b border-line bg-ink/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-5 px-6">
        <Link to="/" className="flex items-center gap-2 font-semibold hover:text-white">
          <img src={logoUrl} alt="" className="h-8 w-8 rounded object-cover" /><span>WaitWatch</span>
        </Link>
        <nav className="flex gap-5 text-sm" aria-label="Nurse dashboard navigation">
          <NavItem to="/dashboard" end>Monitor</NavItem>
          <NavItem to="/enroll">Enroll</NavItem>
        </nav>
        <div className="ml-auto flex min-w-0 items-center gap-3 text-sm">
          <span className="hidden max-w-36 truncate text-fg-muted sm:block">{isLocalDemo ? "Local demo" : nurse?.name ?? "Nurse"}</span>
          <button type="button" className="btn btn-quiet text-xs" onClick={logout}>Log out</button>
        </div>
      </div>
    </header>
    {isLocalDemo && <div className="fixed inset-x-0 top-14 z-20 bg-amber-900/90 px-4 py-1 text-center text-xs text-amber-100">LOCAL DEMO MODE — authentication disabled. Do not use patient information.</div>}
    <main className={isLocalDemo ? "pt-20" : "pt-14"}><Outlet /></main>
  </div>;
}

export function App() {
  return <Routes>
    <Route path="/" element={<Home />} />
    <Route path="/login" element={<Login />} />
    <Route path="/auth/callback" element={<AuthCallback />} />
    <Route path="/checkin/:code" element={<Checkin />} />
    <Route element={<NurseOnly />}>
      <Route element={<NurseLayout />}>
        <Route path="/dashboard" element={<Ward />} />
        <Route path="/enroll" element={<Enroll />} />
        <Route path="/patients/:id" element={<PatientPage />} />
      </Route>
    </Route>
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>;
}
function NavItem({ to, end, children }: { to: string; end?: boolean; children: string }) {
  return <NavLink to={to} end={end} className={({ isActive }) => isActive ? "text-fg font-semibold" : "text-fg-muted hover:text-fg"}>{children}</NavLink>;
}
