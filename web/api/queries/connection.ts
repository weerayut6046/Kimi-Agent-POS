import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { env } from "../lib/env";
import * as schema from "@db/schema";
import * as relations from "@db/relations";

const fullSchema = { ...schema, ...relations };

let client: ReturnType<typeof postgres> | undefined;
let instance: ReturnType<typeof drizzle<typeof fullSchema>> | undefined;
let testCleanup: (() => Promise<void>) | undefined;

function requiresSsl(connectionString: string): boolean {
  const hostname = new URL(connectionString).hostname;
  return hostname !== "localhost" && hostname !== "127.0.0.1";
}

/** PostgreSQL connection shared by the API process. Supabase's pooler requires prepared statements to be disabled. */
export function getDb() {
  if (!instance) {
    client = postgres(env.databaseUrl, {
      prepare: false,
      ssl: requiresSsl(env.databaseUrl) ? "require" : false,
      max: Number(process.env.DATABASE_POOL_SIZE ?? 5),
      idle_timeout: 20,
      connect_timeout: 10,
    });
    instance = drizzle(client, { schema: fullSchema });
  }
  return instance;
}

/** Close the shared PostgreSQL pool. Primarily used by tests and graceful shutdown. */
export async function resetDb() {
  const activeClient = client;
  const cleanup = testCleanup;
  client = undefined;
  instance = undefined;
  testCleanup = undefined;
  if (activeClient) await activeClient.end({ timeout: 5 });
  if (cleanup) await cleanup();
}

/** Inject an isolated PostgreSQL-compatible database for integration tests. */
export function setDbForTests(
  db: ReturnType<typeof drizzle<typeof fullSchema>>,
  cleanup: () => Promise<void>,
) {
  if (process.env.NODE_ENV !== "test") {
    throw new Error("setDbForTests is available only when NODE_ENV=test");
  }
  instance = db;
  testCleanup = cleanup;
}
