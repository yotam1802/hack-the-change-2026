# WaitWatch cleanup and maintenance notes

## Scope

This cleanup deliberately retains the existing npm workspaces, HTTP paths, Zod contract, user interface, scripted patients and Arduino 7-then-5 BPM algorithm. All patient simulation behavior and clinical-style alerts must be treated as demo-only.

## Changes made

1. **BPM bounds end-to-end:** Existing `readingSchema` already supports `bpmMin` and `bpmMax`. `apps/server/src/db/repo.ts` now creates/updates the `last_bpm_min`/`last_bpm_max` patient fields and stores bounds for each ingested reading; idempotent `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` statements upgrade existing local databases. `toView()` includes the bounds in `latest`, making them available through `/api/board` and snapshot messages.
2. **WebSocket updates:** `apps/server/src/roles/worker.ts` now includes BPM bounds in `heart_rate` messages. A range change still pushes a message even if the BPM is unchanged. Repeated identical BPM-and-bounds values retain the existing de-duplication behavior.
3. **Local PGlite query sequencing:** The embedded database adapter serializes `query` and `exec` operations across background workers and HTTP requests. PostgreSQL Pool mode stays concurrent. This reduces possible overlapping protocol use but **does not prove** the prior `received invalid response` errors are fixed; see below.
4. **Environment handling:** `apps/server/src/env.ts` resolves `.env` from the repository root, including folder paths containing spaces. Runtime shell variables take precedence.
5. **Arduino failures:** The Python bridge stops retrying on 401/403 rather than creating a permanently pending batch. Its BPM algorithm remains calculated from incoming Arduino readings, with no timer or randomization.
6. **Repository hygiene:** Added `.env.example`, expanded `.gitignore`, updated README to match the actual firmware, added offline Python unit tests and a `typecheck` command, and tidied Ward formatting. The distribution excludes Git internals, database files, Python virtual environments, caches, and build output.

## Data flow

```text
HW-827 -> Arduino sketch -> firmware/python/main.py -> POST /api/readings
                                               -> in-memory bus -> worker
                                               -> DB patients latest + readings history
                                               -> /api/board snapshots and /ws heart_rate
                                               -> Ward displays sensor-derived filtered BPM and range

Simulator -> same ingestion path, with other device IDs and unchanged readings
```

## PGlite runtime warnings

The reported `received invalid response` exceptions occurred **after startup** and may reflect the database's state, concurrent access, a package defect, or resource pressure. The cause cannot be established from logs alone. The attached original ZIP contained a persistent PGlite directory; it is intentionally **not redistributed** because it can contain patient data, device tokens, and possibly corrupted records.

If running into these errors:

1. Stop all WaitWatch processes. Ensure no second backend is using the same directory.
2. Make a backup of `apps/server/data/pglite` before any destructive operation.
3. Use `PGLITE_PATH=memory` temporarily to see whether a clean ephemeral database avoids the errors. This loses all state when the server exits.
4. If reproducible, record process count, Node version, PGlite version, device rate, exact error and whether the problem occurs with an empty database. Consider testing with Docker PostgreSQL using `DATABASE_URL`.
5. Never remove an existing database to fix errors until its contents have been backed up and you are certain it is disposable demo data.

An HTTP 401 `Unknown device token` is separate: it means the supplied token was not found by the device lookup. It may occur after changing DB instances because devices are recreated; check the device registration and pairing. Do not paste or commit the real token.

## Checks performed for the cleaned ZIP

- Python bridge syntax compilation.
- Four offline Python algorithm regression tests.
- TypeScript/TSX syntax parsing for all project TS/TSX source files.
- Structural verification that the SQL INSERT has matching columns/parameter counts.
- Source packaging excludes `.git`, PGlite database, local `.env`, Python venv, Node cache, and Arduino build artifacts.

**Not verified in this environment:** Full `npm test`, `npm run typecheck`, `vite build`, hardware operation, and PGlite long-running stability. `npm ci` did not complete due to dependency installation/network availability. Run these on your Mac, and examine any failures before deploying or presenting live patient monitoring.

## Commands to run locally

```bash
npm ci
npm run typecheck
npm test
npm run build -w @waitwatch/dashboard
python3 -m unittest discover -s firmware/python -p 'test_*.py'
```

For a one-off integration check, enroll a patient on device-08, feed it seven valid Arduino BPM values, then compare `patient.latest` in `/api/board` with Python's sent `bpmMin`/`bpmMax`. Ensure snapshots and live WebSocket messages reflect bounds as new readings arrive.
