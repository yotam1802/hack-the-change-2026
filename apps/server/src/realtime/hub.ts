import {
  ApiGatewayManagementApiClient,
  PostToConnectionCommand,
} from "@aws-sdk/client-apigatewaymanagementapi";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, QueryCommand } from "@aws-sdk/lib-dynamodb";
import type { WebSocket } from "ws";

export type LiveEvent = Record<string, unknown> & { type: string };

type Socket = { unitId?: string; socket: WebSocket };

export class LocalRealtime {
  private sockets = new Set<Socket>();

  add(socket: WebSocket) {
    const entry: Socket = { socket };
    this.sockets.add(entry);
    socket.on("message", (raw) => {
      try {
        const body = JSON.parse(String(raw)) as { type?: string; unitId?: string };
        if (body.type === "subscribe" && body.unitId) entry.unitId = body.unitId;
      } catch {
        /* ignore malformed client frames */
      }
    });
    socket.on("close", () => this.sockets.delete(entry));
    return entry;
  }

  subscriberCount() {
    return this.sockets.size;
  }

  async push(unitId: string, event: LiveEvent) {
    const data = JSON.stringify(event);
    for (const entry of this.sockets) {
      if (entry.unitId === unitId && entry.socket.readyState === 1) entry.socket.send(data);
    }
  }
}

export class ApigwRealtime {
  private api: ApiGatewayManagementApiClient;
  private doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: process.env.AWS_REGION }));

  constructor(
    endpoint: string,
    private tableName: string,
  ) {
    this.api = new ApiGatewayManagementApiClient({ endpoint, region: process.env.AWS_REGION });
  }

  subscriberCount() {
    return 1;
  }

  async push(unitId: string, event: LiveEvent) {
    const found = await this.doc.send(
      new QueryCommand({
        TableName: this.tableName,
        IndexName: "byUnit",
        KeyConditionExpression: "unitId = :u",
        ExpressionAttributeValues: { ":u": unitId },
      }),
    );
    const data = Buffer.from(JSON.stringify(event));
    await Promise.all(
      (found.Items ?? []).map(async (item) => {
        const connectionId = String(item.connectionId);
        try {
          await this.api.send(new PostToConnectionCommand({ ConnectionId: connectionId, Data: data }));
        } catch (err) {
          const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
          if (status === 410) {
            await this.doc.send(new DeleteCommand({ TableName: this.tableName, Key: { connectionId } }));
          }
        }
      }),
    );
  }
}

export type Realtime = LocalRealtime | ApigwRealtime;
