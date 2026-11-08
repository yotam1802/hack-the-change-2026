/** Auth0 Authorization Code + PKCE flow (public SPA client, no client secret).
 * Uses browser WebCrypto and sessionStorage; the server verifies JWT signatures
 * and the nurse role on every protected API request.
 */
import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { setSessionCredentials } from "../api";

declare const __WAITWATCH_PUBLIC_AUTH0__: {
  domain: string;
  clientId: string;
  audience: string;
  demoMode: boolean;
};

const config = __WAITWATCH_PUBLIC_AUTH0__;
export const authConfigured = Boolean(config.domain && config.clientId && config.audience);
export const isLocalDemo = config.demoMode;
const audience = config.audience.replace(/\/$/, "");
const rolesClaim = `${audience}/roles`;
const SESSION_KEY = "waitwatch-nurse-session";
const TRANSACTION_KEY = "waitwatch-auth-transaction";

type NurseProfile = { sub: string; name: string; email: string; roles: string[] };
type NurseSession = { accessToken: string; expiresAt: number; profile: NurseProfile };
type AuthTransaction = { state: string; verifier: string; nonce: string; returnTo: string };
type AuthValue = {
  ready: boolean;
  authenticated: boolean;
  nurse: NurseProfile | null;
  error: string;
  login: (returnTo?: string) => Promise<void>;
  logout: () => void;
};

const defaultValue: AuthValue = {
  ready: false, authenticated: false, nurse: null, error: "",
  login: async () => {}, logout: () => {},
};
const AuthContext = createContext<AuthValue>(defaultValue);
export const useNurseAuth = () => useContext(AuthContext);

function safeReturnTo(path: string): string {
  return path.startsWith("/") && !path.startsWith("//") && !path.startsWith("/auth/callback") ? path : "/dashboard";
}

function asBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
function randomString(length = 48) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return asBase64Url(bytes);
}
async function challenge(verifier: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return asBase64Url(new Uint8Array(digest));
}
function payload(token: string): Record<string, unknown> {
  const part = token.split(".")[1];
  if (!part) throw new Error("Identity provider returned an invalid token");
  const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
  return JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="))) as Record<string, unknown>;
}
function readSession(): NurseSession | null {
  if (isLocalDemo) return null;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as NurseSession;
    if (!session.accessToken || !session.profile?.roles.includes("nurse") || session.expiresAt < Date.now() + 10_000) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    return session;
  } catch {
    sessionStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export function NurseAuthProvider({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [session, setSession] = useState<NurseSession | null>(() => {
    const saved = readSession();
    setSessionCredentials(saved?.accessToken ?? null, saved?.profile.sub ?? "");
    return saved;
  });
  const [ready, setReady] = useState(window.location.pathname !== "/auth/callback");
  const [error, setError] = useState("");
  const callbackStarted = useRef(false);

  useEffect(() => {
    if (window.location.pathname !== "/auth/callback" || callbackStarted.current) return;
    // One code exchange even when React StrictMode re-runs effects in development.
    callbackStarted.current = true;
    const complete = async () => {
      const query = new URLSearchParams(window.location.search);
      const txRaw = sessionStorage.getItem(TRANSACTION_KEY);
      sessionStorage.removeItem(TRANSACTION_KEY);
      if (!txRaw) throw new Error("Sign-in session expired. Start again from the login page.");
      const tx = JSON.parse(txRaw) as AuthTransaction;
      if (query.get("error")) throw new Error(query.get("error_description") ?? "Sign in was denied.");
      if (!query.get("code") || query.get("state") !== tx.state) throw new Error("Invalid sign-in callback state.");
      const result = await fetch(`https://${config.domain}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          grant_type: "authorization_code", client_id: config.clientId,
          code: query.get("code"), code_verifier: tx.verifier,
          redirect_uri: `${window.location.origin}/auth/callback`,
        }),
      });
      if (!result.ok) throw new Error("Auth0 could not complete sign in. Check the application settings.");
      const data = await result.json() as { access_token?: string; id_token?: string; expires_in?: number; token_type?: string };
      if (!data.access_token || !data.id_token || data.token_type?.toLowerCase() !== "bearer") {
        throw new Error("Auth0 did not return the expected tokens.");
      }
      const claims = payload(data.id_token);
      const roles = claims[rolesClaim];
      if (claims.nonce !== tx.nonce || claims.iss !== `https://${config.domain}/` || claims.aud !== config.clientId ||
          typeof claims.exp !== "number" || claims.exp <= Date.now() / 1000 ||
          typeof claims.sub !== "string") {
        throw new Error("Invalid identity information from Auth0.");
      }
      if (!Array.isArray(roles) || !roles.some((role) => typeof role === "string" && role.toLowerCase() === "nurse")) {
        throw new Error("This account does not have the nurse role. Ask your Auth0 administrator for access.");
      }
      const profile: NurseProfile = {
        sub: claims.sub, name: String(claims.name ?? claims.nickname ?? "Nurse"),
        email: String(claims.email ?? ""), roles: ["nurse"],
      };
      const next: NurseSession = { accessToken: data.access_token,
        expiresAt: Date.now() + Math.max(0, Number(data.expires_in ?? 3600) - 30) * 1000, profile };
      sessionStorage.setItem(SESSION_KEY, JSON.stringify(next));
      setSessionCredentials(next.accessToken, next.profile.sub);
      setSession(next);
      setReady(true);
      navigate(safeReturnTo(tx.returnTo), { replace: true });
    };
    complete().catch((reason) => {
      setSessionCredentials(null, "");
      setSession(null);
      sessionStorage.removeItem(SESSION_KEY);
      setError(reason instanceof Error ? reason.message : "Unable to sign in.");
      setReady(true);
    });
  }, [navigate]);

  async function login(returnTo = "/dashboard") {
    setError("");
    if (isLocalDemo) { navigate(safeReturnTo(returnTo)); return; }
    if (!authConfigured) { setError("Auth0 has not been configured in the root .env."); return; }
    const verifier = randomString(48);
    const state = randomString(24);
    const nonce = randomString(24);
    sessionStorage.setItem(TRANSACTION_KEY, JSON.stringify({ state, verifier, nonce, returnTo: safeReturnTo(returnTo) } satisfies AuthTransaction));
    const url = new URL(`https://${config.domain}/authorize`);
    url.search = new URLSearchParams({
      response_type: "code", client_id: config.clientId,
      redirect_uri: `${window.location.origin}/auth/callback`,
      scope: "openid profile email", audience, state, nonce,
      code_challenge: await challenge(verifier), code_challenge_method: "S256",
    }).toString();
    window.location.assign(url.toString());
  }
  function logout() {
    sessionStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(TRANSACTION_KEY);
    setSessionCredentials(null, "");
    setSession(null);
    if (isLocalDemo || !authConfigured) { navigate("/", { replace: true }); return; }
    const url = new URL(`https://${config.domain}/v2/logout`);
    url.searchParams.set("client_id", config.clientId);
    url.searchParams.set("returnTo", window.location.origin);
    window.location.assign(url.toString());
  }
  const value = useMemo<AuthValue>(() => ({
    ready, authenticated: isLocalDemo || Boolean(session && session.expiresAt > Date.now()),
    nurse: isLocalDemo ? { sub: "local-demo-nurse", name: "Demo nurse", email: "", roles: ["nurse"] } : session?.profile ?? null,
    error, login, logout,
  }), [ready, session, error]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
