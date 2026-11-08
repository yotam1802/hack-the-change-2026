# November 8, 2026 — Development server fixes

This patch is based on the user's startup logs from the six scripted patients.

## Changed files

- `apps/server/package.json`: explicitly exclude `node_modules` and `data` from `tsx watch` restarts (watch had been restarting for installed dependency changes).
- `apps/server/src/gemini/client.ts`: use `gemini-3.8-flash` as the default model in both calls. `GEMINI_MODEL` in `.env` still overrides it.
- `apps/simulator/src/main.ts`: refresh the simulated device enrollment/token after 401 or 409 (e.g. if an in-memory backend database was replaced). The current failed batch is not replayed. Future batches resume when credentials work. Does not affect Arduino `device-08`.
- `apps/server/src/roles/ai.ts`: mark jobs for missing patients as stale rather than repeatedly throwing `patient missing` errors during resets.
- `.env.example`: documents optional `GEMINI_MODEL`.

## Local startup sequence

1. Stop the running development server (`Ctrl+C`).
2. Run `npm ci` **while the server is stopped**; do not install dependencies during `tsx watch`.
3. Put each `.env` entry on a separate line. To use Gemini, set `GEMINI_MODEL=gemini-3.8-flash`; otherwise leave `GEMINI_API_KEY=` blank to disable AI requests.
4. Run `npm run dev`.
5. Expect six simulated devices (device-02 through device-07) to resume and refresh their token if the server/database restarts. Arduino `device-08` is unchanged.

## Known limitations

- The device simulator attempts recovery when a device's token is rejected. If the backend `/api/devices` and `/api/enrollments` endpoints are unavailable, it cannot recover until they are available again.
- This patch does not establish whether there was an underlying PGlite database corruption issue. Keep a copy of local database files before resetting them; **do not delete `apps/server/data/` blindly**.
- The `npm audit` vulnerability warning remains to be investigated. Do not use `npm audit fix --force` without reviewing breaking changes.
- No live Gemini API or local database integration test was run in this sandbox; this package is a targeted patch with static checks.
- These simulated vital-sign scenarios are for nonclinical demos, not patient monitoring.
