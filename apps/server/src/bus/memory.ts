import type { GeminiJob, IngestEnvelope } from "@waitwatch/shared";
import { log } from "../log.js";

export type ReadingHandler = (envelope: IngestEnvelope) => Promise<void>;
export type JobHandler = (job: GeminiJob) => Promise<void>;

export class MemoryBus {
  private readings: IngestEnvelope[] = [];
  private jobs: GeminiJob[] = [];
  private readingHandler: ReadingHandler | null = null;
  private jobHandler: JobHandler | null = null;
  private inflight = 0;
  private jobRunning = false;
  workers = 1;

  depth() {
    return this.readings.length;
  }

  setConcurrency(count: number) {
    this.workers = Math.max(1, Math.min(32, Math.floor(count)));
    this.pumpReadings();
  }

  publishReading(envelope: IngestEnvelope) {
    this.readings.push(envelope);
    this.pumpReadings();
  }

  onReading(handler: ReadingHandler) {
    this.readingHandler = handler;
    this.pumpReadings();
  }

  publishJob(job: GeminiJob) {
    this.jobs.push(job);
    void this.pumpJobs();
  }

  onJob(handler: JobHandler) {
    this.jobHandler = handler;
    void this.pumpJobs();
  }

  private pumpReadings() {
    if (!this.readingHandler) return;
    while (this.inflight < this.workers && this.readings.length > 0) {
      const item = this.readings.shift();
      if (!item) return;
      const handler = this.readingHandler;
      this.inflight += 1;
      handler(item)
        .catch((err) => log.error({ err }, "reading handler failed"))
        .finally(() => {
          this.inflight -= 1;
          this.pumpReadings();
        });
    }
  }

  private async pumpJobs() {
    if (!this.jobHandler || this.jobRunning) return;
    const job = this.jobs.shift();
    if (!job) return;
    this.jobRunning = true;
    try {
      await this.jobHandler(job);
    } catch (err) {
      log.error({ err, job: job.id }, "job handler failed");
    } finally {
      this.jobRunning = false;
      void this.pumpJobs();
    }
  }
}
