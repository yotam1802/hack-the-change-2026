import type { IngestEnvelope } from "@waitwatch/shared";
import { KinesisClient, PutRecordsCommand } from "@aws-sdk/client-kinesis";

const encoder = new TextEncoder();

export function toKinesisRecords(envelopes: IngestEnvelope[]) {
  return envelopes.map((envelope) => ({
    PartitionKey: envelope.patientId.slice(0, 256),
    Data: encoder.encode(JSON.stringify(envelope)),
  }));
}

export async function putReadings(streamName: string, envelopes: IngestEnvelope[]) {
  const client = new KinesisClient({ region: process.env.AWS_REGION });
  const records = toKinesisRecords(envelopes);
  for (let i = 0; i < records.length; i += 400) {
    await client.send(
      new PutRecordsCommand({
        StreamName: streamName,
        Records: records.slice(i, i + 400),
      }),
    );
  }
}
