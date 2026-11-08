import { Link, useLocation } from "react-router-dom";
import { authConfigured, isLocalDemo, useNurseAuth } from "../auth/AuthProvider";
import "./home.css";

export function Login() {
  const { ready, authenticated, error, login } = useNurseAuth();
  const location = useLocation();
  const returnTo = (location.state as { from?: string } | null)?.from ?? "/dashboard";
  return <main className="ww-login-shell">
    <Link to="/" className="ww-login-back">← Back to homepage</Link>
    <div className="ww-login-glow" aria-hidden="true" />
    <section className="ww-login-card" aria-labelledby="ww-login-title">
      <span className="ww-login-badge">WAITWATCH · STAFF ACCESS</span>
      <div className="ww-login-logo" aria-hidden="true"><svg viewBox="0 0 24 24" width="33" height="33" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><path d="M2 12h5l3-7 4 14 3-7h5"/></svg></div>
      <h1 id="ww-login-title">Your ward, <em>your workspace.</em></h1>
      <p>Sign in with an approved nursing account to open the monitoring dashboard.</p>
      {error && <div role="alert" className="ww-login-error">{error}</div>}
      {!authConfigured && !isLocalDemo && <div className="ww-login-error">Auth0 is not configured. Add AUTH0_DOMAIN and AUTH0_CLIENT_ID to the root .env file, then restart Vite.</div>}
      {authenticated ? <Link to="/dashboard" className="ww-btn ww-btn-primary ww-btn-wide">Open dashboard <span aria-hidden="true">→</span></Link> :
        <button type="button" className="ww-btn ww-btn-primary ww-btn-wide" disabled={!ready || (!authConfigured && !isLocalDemo)} onClick={() => void login(returnTo)}>
          {isLocalDemo ? "Open local demonstration" : "Continue with Auth0"} <span aria-hidden="true">→</span>
        </button>}
      <div className="ww-login-foot"><span className="ww-lock-icon">♢</span> {isLocalDemo ? "Local demo mode · authentication disabled" : "Encrypted sign-in · nurse-role authorization"}</div>
    </section>
    <p className="ww-login-note">WaitWatch is an experimental hackathon prototype and is not intended for clinical use.</p>
  </main>;
}

export function AuthCallback() {
  const { ready, error } = useNurseAuth();
  return <main className="ww-login-shell"><section className="ww-login-card"><h1>Completing nurse sign-in</h1>
    {error ? <><p role="alert" className="ww-login-error">{error}</p><Link to="/login" className="ww-btn ww-btn-primary ww-btn-wide">Return to login</Link></> : <p>{ready ? "Redirecting to your dashboard…" : "Checking your account and nurse role…"}</p>}
  </section></main>;
}
