# WaitWatch nurse-only Auth0 login

The landing page and dashboard are integrated with Auth0 using the **Authorization Code Flow with PKCE**, standard browser WebCrypto, and no client secret. `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, and `AUTH0_AUDIENCE` from the project-root `.env` are exposed to the React build only as public SPA settings. `GEMINI_API_KEY` is never exposed by Vite.

## 1. Configure the Auth0 dashboard (required)

1. In your Auth0 tenant create/select an **Application** of type **Single Page Application**, with its public Client ID matching `AUTH0_CLIENT_ID`.
2. Under the app settings, set **Allowed Callback URLs** to `http://localhost:5173/auth/callback`, **Allowed Logout URLs** to `http://localhost:5173`, and **Allowed Web Origins** to `http://localhost:5173`. Add corresponding HTTPS production origins and callbacks if deploying later. Save the application settings.
3. Create/select an Auth0 **API** with identifier exactly `https://waitwatch/api` (matching `AUTH0_AUDIENCE`) and RS256 signing. The server verifies access-token signature, issuer, expiry, and audience.
4. Create an Auth0 role named **`nurse`** (lowercase). Assign this role **only to approved nurses**. Do not enable open self-registration for staff access without appropriate approval.
5. Create an **Action** with the Post-Login trigger, paste `docs/auth0/post-login-nurse-only.js`, deploy it, and attach it to the Login flow. For the WaitWatch Client ID only, it refuses login for accounts without that role and includes a custom `https://waitwatch/api/roles` claim in both access and ID tokens.
6. Use the root `.env` file with `AUTH0_DOMAIN`, `AUTH0_CLIENT_ID`, `AUTH0_AUDIENCE`; run `npm run dev` again, open `http://localhost:5173`, then **Log in as nurse**.

**Nurse authorization requires the Auth0 Action.** Simply creating a nurse role without deploying the Action is insufficient: the API will reject tokens missing the role claim. You cannot assign roles from the frontend.

## 2. Routes and enforcement

| Route | Access |
|---|---|
| `/` | Public marketing homepage |
| `/login`, `/auth/callback` | Public Auth0 sign-in/callback |
| `/dashboard`, `/enroll`, `/patients/:id` | Authenticated nurse only |
| `/checkin/:code` and `/api/public/*` | Existing limited patient check-in endpoints |
| `/api/readings` | Existing device bearer-token authentication (not Auth0) |
| `/api/board`, `/api/patients/*`, staff APIs | Auth0 JWT + required nurse role |
| `/ws` | Initial Auth0 access-token message must be verified before subscription; unauthenticated sockets receive no patient data |

Frontend navigation checks for the nurse role, but **the backend is authoritative**. The nurse identity in staff audit records is taken from the verified JWT subject; the client cannot impersonate another nurse with `x-nurse-id`.

The OAuth authorization code and state are checked on callback and the code is exchanged with PKCE. Tokens are stored only in this tab's sessionStorage, for the lifespan of the access token. Logging out clears them and invokes Auth0 logout. A full token refresh flow is not implemented; after expiry, log in again. For production, prefer the maintained Auth0 SDK, hardened session management, and an external security review.

## 3. Local demo simulator (separate from nurse login)

The six built-in simulator devices must enroll before sending their device-authenticated readings. `ENABLE_LOCAL_SIMULATOR=1` allows **only** explicitly marked requests from `127.0.0.1` / loopback on `/api/enrollments` and `/api/devices` to bootstrap those simulated records. This is an intentional **development-only exception** and is blocked when `NODE_ENV=production`. Keep it off in production. `/api/board` and all staff dashboard routes remain nurse-authenticated.

For an offline UI-only demonstration, `AUTH_DEMO_MODE=1` is an explicit local-only fallback that bypasses nurse authentication and shows an obvious demo banner. **Never enable it for real users or sensitive data.** Stop the app and remove this flag to restore role checks. These simulator and demo-mode exemptions are not production healthcare authentication architecture.

## 4. Common problems

- **Callback URL mismatch:** Make sure `http://localhost:5173/auth/callback` appears exactly in Allowed Callback URLs.
- **Auth0 CORS / token exchange failed:** Add `http://localhost:5173` to Allowed Web Origins.
- **Nurse access required / role missing:** Assign the `nurse` role and deploy/attach the Post-Login Action. Then log out and log in again for fresh tokens.
- **401 from a staff endpoint:** The Authorization header must contain the Auth0-issued API access token. Refresh your sign-in if it has expired.
- **Simulator 401 / 403:** Check `ENABLE_LOCAL_SIMULATOR=1` for local bootstrap, then check device bearer tokens and pairing. The simulator bootstrap is independent of staff OAuth.
- **Arduino ingestion 401:** The Arduino/Python bridge uses its **device token**, not a nurse's Auth0 token.

## 5. Security and operational limitations

This is a hackathon demonstration, **not a clinical product**. The medical dashboard, alerts, simulated BPM, and AI summaries are not validated for clinical decisions. The current API also has publicly accessible device/patient check-in endpoints and infrastructure code outside the local server that need separate production review. Rate limits, audit retention policy, authorization by hospital/unit, short-lived WebSocket session revalidation, CSRF review of public endpoints, and full penetration testing are not implemented.

If any real API key was pasted into chat or committed accidentally, **rotate/revoke it**. Do not include Gemini keys, OAuth client secrets, or database directories in the ZIP or source control.
