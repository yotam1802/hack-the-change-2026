# Start here — new WaitWatch homepage

The project root is unchanged. There is no new npm dependency; the existing `package-lock.json` is preserved.

## Local start

1. Extract the ZIP and open a terminal in `hack-the-change-2026`.
2. If you already have a root `.env`, **keep it** and add `ENABLE_LOCAL_SIMULATOR=1` for the six local test patients. Otherwise copy `.env.example` to `.env`.
3. Open `docs/AUTH0_SETUP.md` and complete the Auth0 Single Page Application callback configuration and nurse-role Post-Login Action. The supplied domain, client ID and audience are already filled into `.env.example` (all public values). Create and assign the `nurse` role in Auth0.
4. Run:

   ```bash
   npm ci
   npm run typecheck
   npm test
   npm run dev
   ```

5. Open `http://localhost:5173/`. The public homepage loads. Click **Log in as nurse**, authenticate with an approved nurse Auth0 account, and then open `/dashboard`.

If you need a **local-only offline UI demonstration** without finishing Auth0 setup, add `AUTH_DEMO_MODE=1` to `.env` and restart. This shows a demo banner and lets the dashboard open without login. **Never use that setting in production or with real patient information.**

## Routes

- `/` public home
- `/login` nurse login screen
- `/auth/callback` Auth0 authorization callback
- `/dashboard` protected Ward
- `/enroll` protected patient enrollment
- `/patients/:id` protected nurse patient timeline
- `/checkin/:code` public patient check-in (original functionality)

## Security

- **Rotate the Gemini API key that was shared in chat.** Keep the new value in your own `.env`, never source control or a ZIP.
- A real nurse login **requires** the Auth0 `nurse` role and the Post-Login Action. The server, not the client, enforces the role.
- The development simulator exemption (`ENABLE_LOCAL_SIMULATOR=1`) is restricted to loopback and should be disabled outside local testing.
- Hackathon simulation only, not clinical use.

## Verification

The TypeScript source was syntax-parsed; the JWT verifier passed five offline checks and the Arduino Python tests passed four checks. A complete Vite build, npm test run and live Auth0 login could not be run in this sandbox because registry dependencies cannot be downloaded here. Run the commands above on your Mac.
