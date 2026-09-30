import "server-only";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { serverEnv } from "@/server/env";
import * as schema from "./schema";

// Runtime connection: DATABASE_URL (pooled, limited app_user role — PRD §8.3).
// Migrations use DATABASE_URL_UNPOOLED via drizzle.config.ts, never this file.
let db: NodePgDatabase<typeof schema> | undefined;

export function getDb(): NodePgDatabase<typeof schema> {
  if (!db) {
    const url = serverEnv().DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    const pool = new Pool({
      connectionString: url,
      max: 5,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 10_000,
    });
    db = drizzle(pool, { schema });
  }
  return db;
}

export type DatabaseStatus = "ok" | "unreachable" | "not_configured";

export async function checkDatabase(): Promise<DatabaseStatus> {
  if (!serverEnv().DATABASE_URL) return "not_configured";
  try {
    await getDb().execute(sql`select 1`);
    return "ok";
  } catch {
    return "unreachable";
  }
}
