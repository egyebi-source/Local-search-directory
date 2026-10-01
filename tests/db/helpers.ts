import { sql } from "drizzle-orm";
import pg from "pg";
import { uuidv7 } from "uuidv7";
import { getDb } from "@/server/db/client";
import { users } from "@/server/db/schema";

export const hasDb = Boolean(process.env.TEST_DATABASE_URL && process.env.TEST_DATABASE_URL_OWNER);

export async function createUser(label: string) {
  const email = `${label}-${uuidv7()}@example.test`;
  const [user] = await getDb().insert(users).values({ email }).returning();
  return user;
}

/** Raw connection as the runtime role, with no app settings applied. */
export async function asAppUserRaw<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL, max: 1 });
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
    await pool.end();
  }
}

/** Run as the owner role (for test setup that must bypass the app). */
export async function asOwner<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const pool = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL_OWNER, max: 1 });
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
    await pool.end();
  }
}

export { sql };

/** Drizzle wraps Postgres errors; assert on the underlying database message. */
export async function expectDbError(promise: Promise<unknown>, pattern: RegExp) {
  const err = await promise.then(
    () => {
      throw new Error("expected the database to reject this query");
    },
    (e: unknown) => e,
  );
  const cause = (err as { cause?: { message?: string } }).cause;
  const message = cause?.message ?? (err as Error).message;
  if (!pattern.test(message)) throw new Error(`expected ${pattern}, got: ${message}`);
}
