import { DeleteMessageCommand, ReceiveMessageCommand, SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import type { GeminiJob } from "@waitwatch/shared";
import { log } from "../log.js";

function client() {
  return new SQSClient({ region: process.env.AWS_REGION });
}

export async function enqueueJob(queueUrl: string, job: GeminiJob) {
  await client().send(new SendMessageCommand({ QueueUrl: queueUrl, MessageBody: JSON.stringify(job) }));
}

export async function pollSqs(queueUrl: string, handler: (job: GeminiJob) => Promise<void>) {
  const sqs = client();
  log.info({ queueUrl }, "sqs consumer started");
  for (;;) {
    const page = await sqs.send(
      new ReceiveMessageCommand({ QueueUrl: queueUrl, MaxNumberOfMessages: 5, WaitTimeSeconds: 20 }),
    );
    for (const message of page.Messages ?? []) {
      if (!message.Body || !message.ReceiptHandle) continue;
      const job = JSON.parse(message.Body) as GeminiJob;
      try {
        await handler(job);
        await sqs.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: message.ReceiptHandle }));
      } catch (err) {
        log.error({ err, job: job.id }, "sqs job failed");
      }
    }
  }
}
