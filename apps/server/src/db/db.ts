import { mkdirSync } from "node:fs";
import { log } from "../log.js";

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  exec(sql: string): Promise<void>;
}

export async function openDb(): Promise<Db> {
  if (process.env.DATABASE_URL || process.env.DB_HOST) {
    const { Pool } = await import("pg");
    const pool = process.env.DATABASE_URL
      ? new Pool({ connectionString: process.env.DATABASE_URL })
      : new Pool({
          host: process.env.DB_HOST,
          port: Number(process.env.DB_PORT ?? 5432),
          user: process.env.DB_USER,
          password: process.env.DB_PASSWORD,
          database: process.env.DB_NAME ?? "waitwatch",
          ssl: process.env.DB_SSL === "require" ? { rejectUnauthorized: false } : undefined,
        });
    return {
      query: (async (sql, params) => {
        const result = await pool.query(sql, params as never[]);
        return { rows: result.rows as never[] };
      }) as Db["query"],
      exec: async (sql) => {
        await pool.query(sql);
      },
    };
  }
  const { PGlite } = await import("@electric-sql/pglite");
  const path = process.env.PGLITE_PATH ?? "data/pglite";
  if (path !== "memory") mkdirSync(path, { recursive: true });
  const db = path === "memory" ? new PGlite() : new PGlite(path);
  await db.waitReady;
  // The local embedded DB is shared by HTTP requests, worker callbacks and
  // snapshot timers. Serialize its operations to avoid overlapping protocol
  // use. PostgreSQL Pool above remains concurrent for load and deployment.
  let tail: Promise<void> = Promise.resolve();
  function enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = tail.then(operation);
    tail = result.then(() => undefined, () => undefined);
    return result;
  }
  return {
    query: (sql, params) => enqueue(async () => {
      const result = await db.query(sql, params as never[]);
      return { rows: result.rows as never[] };
    }),
    exec: (sql) => enqueue(async () => { await db.exec(sql); }),
  };
}

export async function openDbSafe(): Promise<Db> {
  try {
    return await openDb();
  } catch (err) {
    log.error({ err }, "database open failed");
    throw err;
  }
}
