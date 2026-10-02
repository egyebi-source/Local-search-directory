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
  // The database verifies Stripe webhooks itself (billing_webhook), with a
  // copy of the signing secret only the owner role can read.
  const whsec = process.env.STRIPE_WEBHOOK_SECRET;
  if (whsec && /^whsec_[A-Za-z0-9]+$/.test(whsec)) {
    await pool.query(
      "INSERT INTO billing_secrets (id, webhook_secret) VALUES (1, $1) ON CONFLICT (id) DO UPDATE SET webhook_secret = EXCLUDED.webhook_secret",
      [whsec],
    );
    console.log("Stripe webhook secret installed.");
  }
} catch (err) {
  // Print the database's message only — never the connection string.
  console.error("Migration failed:", err instanceof Error ? err.message : "unknown error");
  process.exitCode = 1;
} finally {
  await pool.end();
}
