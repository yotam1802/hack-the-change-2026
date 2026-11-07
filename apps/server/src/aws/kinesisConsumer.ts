import {
  GetRecordsCommand,
  GetShardIteratorCommand,
  KinesisClient,
  ListShardsCommand,
} from "@aws-sdk/client-kinesis";
import type { IngestEnvelope } from "@waitwatch/shared";
import { log } from "../log.js";

const decoder = new TextDecoder();

export async function pollKinesis(
  streamName: string,
  onEnvelope: (envelope: IngestEnvelope, arrivalMs: number) => Promise<void>,
) {
  const client = new KinesisClient({ region: process.env.AWS_REGION });
  const listed = await client.send(new ListShardsCommand({ StreamName: streamName }));
  for (const shard of listed.Shards ?? []) {
    if (!shard.ShardId) continue;
    void pollShard(client, streamName, shard.ShardId, onEnvelope);
  }
  log.info({ shards: listed.Shards?.length ?? 0, streamName }, "kinesis consumers started");
}

async function pollShard(
  client: KinesisClient,
  streamName: string,
  shardId: string,
  onEnvelope: (envelope: IngestEnvelope, arrivalMs: number) => Promise<void>,
) {
  let iterator = (
    await client.send(
      new GetShardIteratorCommand({
        StreamName: streamName,
        ShardId: shardId,
        ShardIteratorType: "LATEST",
      }),
    )
  ).ShardIterator;
  for (;;) {
    if (!iterator) return;
    const page = await client.send(new GetRecordsCommand({ ShardIterator: iterator, Limit: 100 }));
    iterator = page.NextShardIterator;
    for (const record of page.Records ?? []) {
      if (!record.Data) continue;
      const arrival = record.ApproximateArrivalTimestamp
        ? record.ApproximateArrivalTimestamp.getTime()
        : Date.now();
      const envelope = JSON.parse(decoder.decode(record.Data)) as IngestEnvelope;
      await onEnvelope(envelope, arrival);
    }
    await new Promise((resolve) => setTimeout(resolve, page.MillisBehindLatest && page.MillisBehindLatest > 1000 ? 0 : 400));
  }
}
