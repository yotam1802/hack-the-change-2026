import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";

const doc = DynamoDBDocumentClient.from(new DynamoDBClient({}));

export async function handler(event: {
  requestContext: { connectionId: string; routeKey: string };
  queryStringParameters?: { unitId?: string } | null;
}) {
  const connectionId = event.requestContext.connectionId;
  const table = process.env.TABLE_NAME;
  if (!table) return { statusCode: 500, body: "missing table" };
  if (event.requestContext.routeKey === "$disconnect") {
    await doc.send(new DeleteCommand({ TableName: table, Key: { connectionId } }));
  } else {
    await doc.send(
      new PutCommand({
        TableName: table,
        Item: {
          connectionId,
          unitId: event.queryStringParameters?.unitId ?? "ed-waiting",
          connectedAt: Date.now(),
        },
      }),
    );
  }
  return { statusCode: 200, body: "ok" };
}
