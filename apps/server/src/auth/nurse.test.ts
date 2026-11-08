import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { NurseAuthError, verifyNurseToken } from "./nurse.js";

const original = {
  NODE_ENV: process.env.NODE_ENV,
  AUTH0_DOMAIN: process.env.AUTH0_DOMAIN,
  AUTH0_CLIENT_ID: process.env.AUTH0_CLIENT_ID,
  AUTH0_AUDIENCE: process.env.AUTH0_AUDIENCE,
};
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "test-key", use: "sig", alg: "RS256" };
const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
function token(changes: Record<string, unknown> = {}) {
  const header = encode({ alg: "RS256", kid: "test-key" });
  const claims = encode({
    iss: "https://waitwatch.test.auth0.com/", aud: "https://waitwatch/api",
    sub: "auth0|approved-nurse", exp: Math.floor(Date.now() / 1000) + 600,
    "https://waitwatch/api/roles": ["nurse"],
    ...changes,
  });
  const unsigned = `${header}.${claims}`;
  return `${unsigned}.${sign("RSA-SHA256", Buffer.from(unsigned), privateKey).toString("base64url")}`;
}

beforeAll(() => {
  process.env.NODE_ENV = "production"; // Disables test/demo exemptions during JWT checks.
  process.env.AUTH0_DOMAIN = "waitwatch.test.auth0.com";
  process.env.AUTH0_CLIENT_ID = "public-client-id";
  process.env.AUTH0_AUDIENCE = "https://waitwatch/api";
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ keys: [jwk] }) })));
});
afterAll(() => {
  for (const [key, value] of Object.entries(original)) {
    if (value === undefined) delete process.env[key as keyof typeof original];
    else process.env[key] = value;
  }
  vi.unstubAllGlobals();
});

describe("nurse access-token verifier", () => {
  it("accepts a correctly signed token with an assigned nurse role", async () => {
    expect(await verifyNurseToken(token())).toBe("auth0|approved-nurse");
  });
  it("rejects a signed non-nurse token", async () => {
    await expect(verifyNurseToken(token({ "https://waitwatch/api/roles": ["visitor"] })))
      .rejects.toMatchObject({ status: 403 } satisfies Partial<NurseAuthError>);
  });
  it("rejects an incorrect API audience", async () => {
    await expect(verifyNurseToken(token({ aud: "https://other/api" }))).rejects.toBeInstanceOf(NurseAuthError);
  });
  it("rejects expired tokens", async () => {
    await expect(verifyNurseToken(token({ exp: Math.floor(Date.now() / 1000) - 10 }))).rejects.toBeInstanceOf(NurseAuthError);
  });
  it("rejects bad signatures", async () => {
    const altered = token().replace(/.$/, "Z");
    await expect(verifyNurseToken(altered)).rejects.toBeInstanceOf(NurseAuthError);
  });
});
