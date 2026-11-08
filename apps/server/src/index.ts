import "./env.js";
import { createServer } from "node:http";
import { WebSocketServer } from "ws";
import { MemoryBus } from "./bus/memory.js";
import { openDb } from "./db/db.js";
import { migrate, seedDevices } from "./db/repo.js";
import { Metrics, publishCloudWatch } from "./metrics.js";
import { LocalRealtime } from "./realtime/hub.js";
import { attachWorker } from "./roles/worker.js";
import { runJob } from "./roles/ai.js";
import { createApp, startDueSweep, startSnapshots } from "./roles/http.js";
import { MemoryState } from "./state/store.js";
import { log } from "./log.js";
import { pollKinesis } from "./aws/kinesisConsumer.js";
import { putReadings } from "./aws/kinesis.js";
import { enqueueJob, pollSqs } from "./aws/sqs.js";
import { DynamoState } from "./state/store.js";
import { ApigwRealtime } from "./realtime/hub.js";
import { handleEnvelope } from "./roles/worker.js";

export async function boot(listenPort?: number) {
  const role = process.env.ROLE ?? "all";
  const mode = role === "all" ? "local" : "aws";
  if (role !== "all" && !process.env.DATABASE_URL && !process.env.DB_HOST) {
    throw new Error("Split roles need DATABASE_URL or DB_HOST pointing at Aurora");
  }
  const db = await openDb();
  await migrate(db);
  await seedDevices(db);

  const metrics = new Metrics();
  const localBus = new MemoryBus();
  const state = process.env.STATE === "dynamodb"
    ? new DynamoState(process.env.DYNAMO_STATE_TABLE ?? "waitwatch-state")
    : new MemoryState();
  const rt = process.env.REALTIME === "apigw"
    ? new ApigwRealtime(process.env.WS_ENDPOINT ?? "", process.env.DYNAMO_CONN_TABLE ?? "waitwatch-connections")
    : new LocalRealtime();

  const bus = localBus;
  if (role === "ingest" || role === "api" || role === "all") {
    if (process.env.BUS === "kinesis") {
      const stream = process.env.KINESIS_STREAM_NAME ?? "";
      const queue = process.env.SQS_QUEUE_URL ?? "";
      bus.publishReading = (envelope) => {
        void putReadings(stream, [envelope]);
      };
      bus.publishJob = (job) => {
        void enqueueJob(queue, job);
      };
    }
  }

  const deps = { db, bus, state, rt, metrics, mode };
  const app = createApp(deps);
  const server = createServer(app);

  if (rt instanceof LocalRealtime) {
    const wss = new WebSocketServer({ server, path: "/ws" });
    wss.on("connection", (socket) => rt.add(socket));
  }

  if (role === "all" || role === "worker") {
    if (process.env.BUS === "kinesis") {
      await pollKinesis(process.env.KINESIS_STREAM_NAME ?? "", async (envelope, arrival) => {
        metrics.iteratorAgeMs = Date.now() - arrival;
        await handleEnvelope(deps, envelope);
      });
    } else {
      attachWorker(bus, deps);
    }
  }

  if (role === "all" || role === "ai") {
    const handler = (job: Parameters<typeof runJob>[2]) => runJob(db, rt, job);
    if (process.env.BUS === "kinesis") {
      void pollSqs(process.env.SQS_QUEUE_URL ?? "", handler);
    } else {
      bus.onJob(handler);
    }
  }

  if (role === "all" || role === "api") {
    startDueSweep(deps);
    startSnapshots(deps);
  }

  const cloudTimer = setInterval(() => {
    const snap = metrics.snapshot({ busDepth: bus.depth(), workers: bus.workers, mode });
    publishCloudWatch(snap).catch((err) => log.error({ err }, "cloudwatch publish failed"));
  }, 60_000);
  cloudTimer.unref?.();

  const port = listenPort ?? (role === "worker" || role === "ai" ? Number(process.env.HEALTH_PORT ?? 8788) : Number(process.env.PORT ?? 8787));
  await new Promise<void>((resolve) => server.listen(port, resolve));
  log.info({ role, port, mode }, "waitwatch listening");
  return { server, port, deps };
}

const invoked = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop() ?? "x");
if (invoked) {
  boot().catch((err) => {
    log.error({ err }, "fatal");
    process.exit(1);
  });
}
