export class Metrics {
  ingestRequests = 0;
  ingestReadings = 0;
  ingestLatencies: number[] = [];
  alertLatencies: number[] = [];
  processLag: number[] = [];
  prompts = 0;
  iteratorAgeMs = 0;
  readonly startedAt = Date.now();

  noteIngest(ms: number, readings: number) {
    this.ingestRequests += 1;
    this.ingestReadings += readings;
    this.push(this.ingestLatencies, ms);
  }

  noteAlert(ms: number) {
    this.prompts += 1;
    this.push(this.alertLatencies, ms);
  }

  noteLag(ms: number) {
    this.push(this.processLag, ms);
  }

  private push(list: number[], value: number) {
    list.push(value);
    if (list.length > 4000) list.splice(0, list.length - 4000);
  }

  snapshot(extra: { busDepth: number; workers: number; mode: string }) {
    return {
      mode: extra.mode,
      uptimeSec: Math.round((Date.now() - this.startedAt) / 1000),
      ingestRequests: this.ingestRequests,
      ingestReadings: this.ingestReadings,
      readingsPerSec: this.ingestReadings / Math.max(1, (Date.now() - this.startedAt) / 1000),
      p95IngestMs: percentile(this.ingestLatencies, 0.95),
      p95ProcessLagMs: percentile(this.processLag, 0.95),
      p95AlertMs: percentile(this.alertLatencies, 0.95),
      prompts: this.prompts,
      busDepth: extra.busDepth,
      workers: extra.workers,
      iteratorAgeMs: this.iteratorAgeMs,
      targetAlertMs: 1000,
    };
  }
}

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

export async function publishCloudWatch(snapshot: ReturnType<Metrics["snapshot"]>) {
  if (process.env.CLOUDWATCH_METRICS !== "1") return;
  const { CloudWatchClient, PutMetricDataCommand } = await import("@aws-sdk/client-cloudwatch");
  const client = new CloudWatchClient({ region: process.env.AWS_REGION });
  const points = [
    ["IngestRequests", snapshot.ingestRequests],
    ["BusDepth", snapshot.busDepth],
    ["IteratorAge", snapshot.iteratorAgeMs],
    ["AlertLatencyP95", snapshot.p95AlertMs ?? 0],
  ] as const;
  await client.send(
    new PutMetricDataCommand({
      Namespace: "WaitWatch",
      MetricData: points.map(([name, value]) => ({
        MetricName: name,
        Value: value,
        Unit: "None",
      })),
    }),
  );
}

export async function readCloudWatch() {
  if (process.env.CLOUDWATCH_METRICS !== "1") return null;
  const { CloudWatchClient, GetMetricDataCommand } = await import("@aws-sdk/client-cloudwatch");
  const client = new CloudWatchClient({ region: process.env.AWS_REGION });
  const end = new Date();
  const start = new Date(end.getTime() - 15 * 60_000);
  const result = await client.send(
    new GetMetricDataCommand({
      StartTime: start,
      EndTime: end,
      MetricDataQueries: ["IngestRequests", "BusDepth", "IteratorAge", "AlertLatencyP95"].map((name, i) => ({
        Id: `m${i}`,
        MetricStat: {
          Metric: { Namespace: "WaitWatch", MetricName: name },
          Period: 60,
          Stat: "Average",
        },
      })),
    }),
  );
  return result.MetricDataResults ?? [];
}
