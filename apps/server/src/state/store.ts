import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, GetCommand, PutCommand } from "@aws-sdk/lib-dynamodb";
import { initialState, type RuntimeState } from "../rules/engine.js";

export class MemoryState {
  private values = new Map<string, RuntimeState>();
  private chains = new Map<string, Promise<unknown>>();

  async update<T>(
    patientId: string,
    fn: (prev: RuntimeState | null) => Promise<{ state: RuntimeState; result: T }>,
  ): Promise<T> {
    const previous = this.chains.get(patientId) ?? Promise.resolve();
    const run = previous.then(async () => {
      const current = this.values.get(patientId) ?? null;
      const out = await fn(current);
      this.values.set(patientId, out.state);
      return out.result;
    });
    this.chains.set(
      patientId,
      run.then(
        () => undefined,
        () => undefined,
      ),
    );
    return run;
  }
}

function documentClient() {
  return DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION }), {
    marshallOptions: { removeUndefinedValues: true },
  });
}

export class DynamoState {
  private doc = documentClient();
  constructor(private tableName: string) {}

  async update<T>(
    patientId: string,
    fn: (prev: RuntimeState | null) => Promise<{ state: RuntimeState; result: T }>,
  ): Promise<T> {
    for (let attempt = 0; attempt < 6; attempt++) {
      const current = await this.read(patientId);
      const out = await fn(current);
      const expected = current?.version ?? -1;
      try {
        await this.doc.send(
          new PutCommand({
            TableName: this.tableName,
            Item: { patientId, state: out.state, version: out.state.version },
            ConditionExpression: expected < 0 ? "attribute_not_exists(patientId)" : "version = :v",
            ExpressionAttributeValues: expected < 0 ? undefined : { ":v": expected },
          }),
        );
        return out.result;
      } catch (err) {
        const name = err instanceof Error ? err.name : "";
        if (name !== "ConditionalCheckFailedException") throw err;
      }
    }
    throw new Error(`Could not update state for ${patientId}`);
  }

  private async read(patientId: string): Promise<RuntimeState | null> {
    const result = await this.doc.send(new GetCommand({ TableName: this.tableName, Key: { patientId } }));
    const state = result.Item?.state as RuntimeState | undefined;
    return state ?? null;
  }
}

export type StateStore = MemoryState | DynamoState;

export function emptyState(patientId: string, pairedAt: number, roomTempC: number | null) {
  return initialState(patientId, pairedAt, roomTempC);
}

export async function deleteState(tableName: string, patientId: string) {
  await documentClient().send(new DeleteCommand({ TableName: tableName, Key: { patientId } }));
}
