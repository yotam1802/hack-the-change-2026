# WaitWatch homepage & nurse login changes (November 8, 2026)

## Added

- Public, responsive one-page homepage at `/`, with an original AI-generated hero concept illustration (delivered as optimized WebP), three feature cards, process explanation, overview and final staff CTA.
- Accessible nurse sign-in page at `/login` and Auth0 callback at `/auth/callback`.
- Authorization Code + PKCE sign-in, state/nonce checks, role check on frontend, and secure server-side JWT (RS256/JWKS) validation. No new npm dependencies are required.
- Backend role enforcement on patient/staff API endpoints, and access-token authorization of WebSocket subscriptions.
- Auth0 Post-Login Action example and complete setup instructions in `docs/AUTH0_SETUP.md`.
- Cursor and focus styles for interactive controls, subtle hover transitions and neon accents on landing page CTAs.
- Local-only opt-in simulator bootstrap for the six scripted test patients; local demo-mode fallback can be explicitly enabled.
- New JWT authorization regression test file.

## Routes

- `/` — public home
- `/login` — nurse login CTA, redirects to Auth0 Universal Login
- `/auth/callback` — PKCE completion
- `/dashboard` — existing Ward, nurse only
- `/enroll` — existing enrollment, nurse only
- `/patients/:id` — existing patient timeline, nurse only
- `/checkin/:code` — existing patient-facing public check-in (not gated)

## Existing features preserved

- Arduino HW-827 and Python pulse filtering, calibration and BPM ranges (no changes)
- Six scripted simulated patients and per-second updates
- Ward popup alerts, 120-BPM/AI classification, 15-second dismiss cooldown
- Enroll, patient timeline and public check-in
- PGlite/Postgres persistence and WebSocket live updates

## Important setup requirements

The Auth0 public domain and public client ID are prefilled in `.env.example`, based on the supplied project configuration. You **must** configure an Auth0 Single Page Application, API, `nurse` role, and Post-Login Action according to `docs/AUTH0_SETUP.md` or a nurse cannot complete login. A custom role claim must be present in both access and ID tokens.

The user's Gemini key is not included in any source file, example environment or ZIP. Rotate/revoke the previously shared key and supply a new one locally if optional AI features are desired.

For local streaming demo patients, add `ENABLE_LOCAL_SIMULATOR=1` to your root `.env`. This is a loopback-only development exception. To temporarily bypass Auth0 during an offline development demonstration, add `AUTH_DEMO_MODE=1` (and remove it immediately afterward). Never deploy with a login bypass or use a hackathon app for real patient monitoring.

## Verification scope

- Parsed all TypeScript/TSX source files syntactically.
- Offline JWT checks: valid nurse, missing nurse role, wrong audience, expired token, tampered signature.
- Arduino Python algorithm: four unittest cases passed.
- Dependencies could not be installed in this sandbox (npm registry DNS unavailable); therefore full Vite UI typecheck/build and live Auth0 tenant login are **not yet verified**.
