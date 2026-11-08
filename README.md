# WaitWatch — waiting-room monitoring prototype

WaitWatch is a hackathon demonstration of a waiting-room dashboard using a React/Vite UI, an Express/TypeScript API, an embedded PGlite database (or PostgreSQL), a six-patient scripted simulator, and an experimental Arduino HW-827 pulse bridge.

**Demo only. Not a medical device.** Experimental BPM estimates and simulated vital signs are not appropriate for diagnosis, triage, clinical alerts, or patient decisions. The Arduino HW-827 does not measure blood oxygen, skin temperature, falls, or motion. The dashboard's CTAS labels and alert rules are prototype features, not clinical validation.

## Quick start

Requires Node.js 22+, npm and Python 3.10+ for the optional hardware bridge.

```bash
npm ci
cp .env.example .env   # edit only if needed
npm test
npm run typecheck
npm run dev
```

Open <http://localhost:5173>. `npm run dev` starts the API on port 8787, the six scripted patients, and the dashboard. The React dashboard and backend communicate through Vite's proxy. The simulator uses separate devices from Arduino `device-08`.

The root `.env` is loaded regardless of the workspace working directory; shell environment variables override it. Each setting should be on a **separate line**. The default local database is stored under `apps/server/data/pglite`; `PGLITE_PATH=memory` gives a temporary disposable database. Empty `GEMINI_API_KEY` disables AI analysis. The other Auth0 variables in the example are placeholders and do not enable authentication by themselves.

## Arduino pulse bridge

Upload `firmware/sketch/sketch.ino` to the Arduino with the HW-827 connected to A0. The sketch prints `Heart Rate: <value> BPM` whenever it calculates a BPM; it does **not** emit a reading at a fixed interval.

```bash
python3 -m pip install pyserial
SERIAL=/dev/cu.usbmodemXXXX DEVICE_ID=device-08 python3 firmware/python/main.py
```

The Python bridge forwards **one reading per valid Arduino BPM**, not every second and not in fixed batches. The first 7 BPM readings initialize a range by removing one outlier and computing the mean ± sample standard deviation of the remaining 6. Every subsequent reading slides a 5-BPM window by one, drops one outlier and recalculates the filtered mean ± sample standard deviation of the remaining 4. It sends `bpm`, `bpmMin` (rounded down) and `bpmMax` (rounded up).

By default, the bridge also sends **simulated** SpO₂ 98% and skin temperature 33.4 °C for a demo; set `DEMO_STUB_VITALS=0` to use null values. It sends no reading without a new sensor BPM and does not create random heart rates. If the server rejects device authentication (401/403), verify that the device exists, is paired, and the token matches; pass `DEVICE_TOKEN` via the shell rather than committing it.

Run offline pulse algorithm checks:

```bash
python3 -m unittest discover -s firmware/python -p 'test_*.py'
```

## Repository layout

| Directory | Purpose |
|---|---|
| `apps/dashboard/` | React/Vite nurse-facing Ward and patient timeline |
| `apps/server/` | Express API, ingestion worker, rules, PGlite/Postgres persistence, real-time updates, tests |
| `apps/simulator/` | Six scripted patients; load generator |
| `apps/patient/` | Lightweight patient check-in page |
| `apps/ws-handlers/` | AWS WebSocket connection handler |
| `packages/shared/` | Zod schemas and shared TypeScript types |
| `firmware/sketch/` | Arduino HW-827 pulse estimation sketch |
| `firmware/python/` | Sensor-to-API bridge and Python regression tests |
| `infra/` | AWS CDK, Docker Compose and load-test scripts |
| `docs/` | Architecture, troubleshooting, and maintenance notes |

## API and live readings

The server accepts device-authorized batches at `POST /api/readings` and publishes them to a local in-memory bus. The worker saves BPM and the associated integer bounds. `/api/board` returns patient `latest` values, and `/ws` publishes `heart_rate` updates. The Ward displays **filtered sensor estimates** for Arduino device `device-08`, not an independent browser randomization. Other patients use their scripted readings unchanged.

The Ward includes a 120-BPM static alert and urgent AI prompts. Closing the popup suppresses its **visual notification** for 15 seconds; underlying prompts are not acknowledged or cleared by that action.

## Development commands

```bash
npm test
npm run typecheck
npm run build -w @waitwatch/dashboard
```

To use external Postgres instead of embedded PGlite:

```bash
docker compose -f infra/docker-compose.yml up -d
DATABASE_URL=postgres://waitwatch:waitwatch@localhost:5432/waitwatch npm run dev -w @waitwatch/server
```

The six simulated patients run with `npm run dev` at the root. For load testing against a running server:

```bash
npm run load -- --patients=2000 --seconds=12
```

## Optional AI features

Set `GEMINI_API_KEY` in the root `.env` to enable Gemini note drafting and an experimental BPM pattern screening check. With no key, note drafting uses a rules-based fallback and periodic AI screening is disabled. AI prompts are for demonstration and must not be used for clinical actions.

## AWS infrastructure

`infra/` contains a CDK stack for ECS Fargate, Kinesis, DynamoDB, SQS, API Gateway WebSockets, Aurora PostgreSQL Serverless v2, Cognito, and CloudFront.

```bash
npm run synth -w @waitwatch/infra
# Actual deployment requires AWS credentials and infrastructure review.
```

## Troubleshooting and project notes

See [docs/MAINTENANCE.md](docs/MAINTENANCE.md). Do not commit `.env`, the local PGlite database, compiled sketch output, `.git`, or Python virtual environments into a source ZIP. Local patient data and device tokens may be present in the PGlite directory, so back it up separately if you need it.
