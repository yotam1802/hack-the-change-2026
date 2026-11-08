/** Auth0 access-token verification for nurse-only API access.
 * Uses Node's built-in crypto so the existing npm lockfile stays reproducible.
 * The browser is never trusted to choose its nurse identity or role.
 */
import { createPublicKey, verify as verifySignature } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

type JwtPayload = Record<string, unknown> & { sub?: string; iss?: string; aud?: string | string[]; exp?: number; nbf?: number };
type Jwk = JsonWebKey & { kid?: string; alg?: string; use?: string };
type Jwks = { keys?: Jwk[] };

let jwksCache: { host: string; expires: number; keys: Jwk[] } | null = null;

const domain = () => (process.env.AUTH0_DOMAIN ?? "").trim().replace(/^https?:\/\//, "").replace(/\/$/, "");
const audience = () => (process.env.AUTH0_AUDIENCE ?? "https://waitwatch/api").trim();
const roleClaim = () => `${audience().replace(/\/$/, "")}/roles`;
const isTesting = () => process.env.NODE_ENV !== "production" && (process.env.VITEST === "true" || process.env.NODE_ENV === "test");
export const localDemoMode = () => (isTesting() || (process.env.AUTH_DEMO_MODE === "1" && process.env.NODE_ENV !== "production"));

export class NurseAuthError extends Error {
  constructor(message: string, public status = 401) { super(message); }
}

const decodeBase64Url = (value: string) => Buffer.from(value, "base64url");

async function getKeys(host: string): Promise<Jwk[]> {
  if (jwksCache?.host === host && Date.now() < jwksCache.expires) return jwksCache.keys;
  const url = `https://${host}/.well-known/jwks.json`;
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new NurseAuthError("Identity provider temporarily unavailable", 503);
  const data = await response.json() as Jwks;
  if (!Array.isArray(data.keys) || data.keys.length === 0) {
    throw new NurseAuthError("Identity provider keys unavailable", 503);
  }
  jwksCache = { host, keys: data.keys, expires: Date.now() + 10 * 60_000 };
  return data.keys;
}

export async function verifyNurseToken(token: string): Promise<string> {
  if (localDemoMode()) return "local-demo-nurse";
  const host = domain();
  if (!host || !process.env.AUTH0_CLIENT_ID) {
    throw new NurseAuthError("Nurse sign-in is not configured", 503);
  }
  if (!/^[\w.-]+$/.test(host)) throw new NurseAuthError("Invalid identity provider configuration", 503);

  if (token.length > 12_000) throw new NurseAuthError("Invalid access token");
  const parts = token.split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) throw new NurseAuthError("Invalid access token");
  let header: { alg?: string; kid?: string };
  let claims: JwtPayload;
  try {
    header = JSON.parse(decodeBase64Url(parts[0]).toString("utf8"));
    claims = JSON.parse(decodeBase64Url(parts[1]).toString("utf8"));
  } catch {
    throw new NurseAuthError("Invalid access token");
  }
  if (header.alg !== "RS256" || typeof header.kid !== "string") throw new NurseAuthError("Unsupported access token");
  const keys = await getKeys(host);
  let key = keys.find((entry) => entry.kid === header.kid && entry.kty === "RSA" && (!entry.use || entry.use === "sig"));
  if (!key) {
    jwksCache = null; // Allow key rotation without waiting for cache expiry.
    key = (await getKeys(host)).find((entry) => entry.kid === header.kid && entry.kty === "RSA" && (!entry.use || entry.use === "sig"));
  }
  if (!key) throw new NurseAuthError("Unrecognized access-token key");
  let valid = false;
  try {
    valid = verifySignature("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`),
      createPublicKey({ key, format: "jwk" }), decodeBase64Url(parts[2]));
  } catch { /* bad key or signature */ }
  if (!valid) throw new NurseAuthError("Invalid access-token signature");

  const now = Math.floor(Date.now() / 1000);
  const audiences = typeof claims.aud === "string" ? [claims.aud] : claims.aud;
  if (claims.iss !== `https://${host}/` || !Array.isArray(audiences) || !audiences.includes(audience()) ||
      typeof claims.exp !== "number" || claims.exp <= now ||
      (typeof claims.nbf === "number" && claims.nbf > now) ||
      typeof claims.sub !== "string" || !claims.sub) {
    throw new NurseAuthError("Expired or incorrectly scoped access token");
  }
  const roles = claims[roleClaim()];
  if (!Array.isArray(roles) || !roles.some((role) => typeof role === "string" && role.toLowerCase() === "nurse")) {
    throw new NurseAuthError("Nurse access required", 403);
  }
  return claims.sub;
}

type NurseRequest = Request & { verifiedNurseId?: string };
export const verifiedNurse = (req: Request) => (req as NurseRequest).verifiedNurseId ?? "";

function loopback(address: string | undefined) {
  return address === "::1" || address === "127.0.0.1" || address === "::ffff:127.0.0.1";
}

// An explicitly enabled local-only simulator bootstrap, never valid in production.
function simulatorRequest(req: Request): boolean {
  return process.env.NODE_ENV !== "production" && process.env.ENABLE_LOCAL_SIMULATOR === "1" &&
    loopback(req.socket.remoteAddress) && req.header("x-waitwatch-demo-simulator") === "1" &&
    ((req.path === "/enrollments" && req.method === "POST") ||
     (req.path === "/devices" && ["GET", "POST"].includes(req.method)));
}

export async function requireNurse(req: Request, res: Response, next: NextFunction) {
  // This middleware is mounted at /api, so req.path is relative to that prefix.
  if (req.path === "/health" || req.path === "/readings" || req.path.startsWith("/public/") ||
      req.path === "/surveys") return next();
  if (simulatorRequest(req)) {
    (req as NurseRequest).verifiedNurseId = "local-simulator";
    return next();
  }
  if (localDemoMode()) {
    (req as NurseRequest).verifiedNurseId = "local-demo-nurse";
    return next();
  }
  const authorization = req.header("authorization") ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(authorization);
  if (!match) return res.status(401).json({ error: "Nurse login required" });
  try {
    (req as NurseRequest).verifiedNurseId = await verifyNurseToken(match[1]);
    return next();
  } catch (error) {
    const status = error instanceof NurseAuthError ? error.status : 503;
    return res.status(status).json({ error: error instanceof NurseAuthError ? error.message : "Authentication service unavailable" });
  }
}
