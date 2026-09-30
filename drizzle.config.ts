import { defineConfig } from "drizzle-kit";

// Migrations run as the database owner over a direct (unpooled) connection.
// Locally, `vercel env pull .env.local` provides the value.
try {
  process.loadEnvFile(".env.local");
} catch {
  // No .env.local — rely on the real environment (CI / Vercel build).
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED ?? "" },
  strict: true,
  verbose: true,
});
