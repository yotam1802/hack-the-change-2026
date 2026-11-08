# WaitWatch

Waiting-room monitor modeled on the Dartmouth General wearables pilot. Nurses keep CTAS priority. The wearable records heart rate, motion, and approximate skin temperature, and prompts a reassessment when a patient drifts from their own resting baseline.

Not a medical device.

## Run it locally

```bash
npm install
npm test
npm run dev
```

Open http://localhost:5173. The simulator enrolls six scripted patients (stable, tachycardia, fall, loose sensor, rising skin temperature, irregular rhythm) and streams them sped up so the prompts appear within a minute.

Postgres is embedded for local development. To use Docker Postgres instead:

```bash
docker compose -f infra/docker-compose.yml up -d
DATABASE_URL=postgres://waitwatch:waitwatch@localhost:5432/waitwatch npm run dev -w @waitwatch/server
```

Set `GEMINI_API_KEY` to draft notes with Gemini. Without it, the same jobs return a rules-based draft and say so.

## Load

With the server running:

```bash
npm run load -- --patients=2000 --seconds=12
```

That enrolls 2,000 patients, streams about one reading per patient per second, then raises local worker concurrency from 1 to 4. `infra/k6/ingest.js` is the same ingest call for k6.

## AWS

`infra/` is an AWS CDK app: ECS Fargate (ingest, API, workers, Gemini), an ALB, Kinesis, DynamoDB, SQS, API Gateway WebSockets, Aurora PostgreSQL Serverless v2, Cognito, and CloudFront.

```bash
npm run synth -w @waitwatch/infra
npx -w @waitwatch/infra cdk deploy
```

A real deploy builds `Dockerfile` (Docker required). `npm run synth` passes a public image so the template can be synthesized without Docker. After deploy, scale workers with:

```bash
aws ecs update-service --cluster <cluster> --service Workers --desired-count 3
```

Upload `apps/dashboard/dist` (from `npm run build -w @waitwatch/dashboard`) to the dashboard bucket.

## Firmware

`firmware/sketch/sketch.ino` reads the HW-827 and GY-80 (including BMP085 skin temperature) and prints one JSON reading per second. `firmware/python/main.py` batches five readings and posts them with `DEVICE_TOKEN`.

The patient check-in page is http://localhost:5173/checkin/CODE and also `apps/patient/index.html?code=CODE`.
