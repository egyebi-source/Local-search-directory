import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

// Database tests run against a throwaway Postgres database:
//   TEST_DATABASE_URL_OWNER  owner role, used to reset + migrate
//   TEST_DATABASE_URL        app_user role, used by the code under test
// The reset drops every table, so it refuses any database not named *_test.
export default async function setup() {
  const ownerUrl = process.env.TEST_DATABASE_URL_OWNER;
  if (!ownerUrl || !process.env.TEST_DATABASE_URL) {
    if (process.env.CI) throw new Error("CI must set TEST_DATABASE_URL and TEST_DATABASE_URL_OWNER");
    console.warn("\n⚠ Database tests skipped: TEST_DATABASE_URL(_OWNER) not set.\n");
    return;
  }
  const dbName = new URL(ownerUrl).pathname.slice(1);
  if (!dbName.endsWith("_test")) {
    throw new Error(`Refusing to reset database "${dbName}": name must end with _test`);
  }

  const pool = new pg.Pool({ connectionString: ownerUrl, max: 1 });
  try {
    await pool.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    await pool.query("GRANT USAGE ON SCHEMA public TO app_user");
    await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  } finally {
    await pool.end();
  }
}
