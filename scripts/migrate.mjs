// Applies Drizzle migrations as the database owner (DATABASE_URL_UNPOOLED).
// Runs before `next build` on Vercel, so every deploy has an up-to-date schema.
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const url = process.env.DATABASE_URL_UNPOOLED;

if (!url) {
  if (process.env.VERCEL) {
    console.error("DATABASE_URL_UNPOOLED is not set; refusing to deploy without migrations.");
    process.exit(1);
  }
  console.log("DATABASE_URL_UNPOOLED not set; skipping migrations (local build).");
  process.exit(0);
}

const pool = new pg.Pool({ connectionString: url, max: 1 });
try {
  await migrate(drizzle(pool), { migrationsFolder: "./drizzle" });
  console.log("Migrations applied.");
} catch (err) {
  // Print the database's message only — never the connection string.
  console.error("Migration failed:", err instanceof Error ? err.message : "unknown error");
  process.exitCode = 1;
} finally {
  await pool.end();
}
