import "server-only";
import { z } from "zod";

// Treat an empty value ("FOO=") the same as an unset one.
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), schema.optional());

// Server-side settings, validated with Zod. Each phase adds the variables it
// needs here (see .env.example). Nothing in this file may reach the browser.
const serverEnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  // "production" | "preview" | "development" on Vercel; unset locally.
  VERCEL_ENV: optional(z.enum(["production", "preview", "development"])),
  VERCEL_URL: optional(z.string().min(1)),
  VERCEL_PROJECT_PRODUCTION_URL: optional(z.string().min(1)),
  AUTH_URL: optional(z.url()),
  DATABASE_URL: optional(z.string().regex(/^postgres(ql)?:\/\//, "must be a postgres:// URL")),

  // Login (Phase 1). AUTH_SECRET is read by Auth.js directly; validated here
  // so a missing or weak value fails loudly.
  AUTH_SECRET: optional(z.string().min(32, "must be at least 32 characters")),
  GOOGLE_LOGIN_CLIENT_ID: optional(z.string().min(1)),
  GOOGLE_LOGIN_CLIENT_SECRET: optional(z.string().min(1)),
  RESEND_API_KEY: optional(z.string().startsWith("re_")),
  EMAIL_FROM: optional(z.string().min(3)),

  // Assessment (Phase 2). DataForSEO stays on its free sandbox (dummy data)
  // unless DATAFORSEO_MODE=live is set deliberately.
  DATAFORSEO_LOGIN: optional(z.string().min(1)),
  DATAFORSEO_PASSWORD: optional(z.string().min(1)),
  DATAFORSEO_MODE: z.enum(["sandbox", "live"]).default("sandbox"),
  GEMINI_API_KEY: optional(z.string().min(1)),
  GEMINI_MODEL: z.string().min(1).default("gemini-2.5-flash"),
  DAILY_SPEND_CAP_DATAFORSEO_CENTS: z.coerce.number().int().min(0).default(200),
  DAILY_SPEND_CAP_GEMINI_CENTS: z.coerce.number().int().min(0).default(100),
  ASSESSMENTS_PER_IP_PER_DAY: z.coerce.number().int().min(1).default(3),
  ASSESSMENTS_GLOBAL_PER_DAY: z.coerce.number().int().min(1).default(50),
  TURNSTILE_SECRET_KEY: optional(z.string().min(1)),

  // Card billing (Stripe). Previews must use test keys (sk_test_...).
  STRIPE_SECRET_KEY: optional(z.string().regex(/^sk_(test|live)_[A-Za-z0-9]+$/, "must be a Stripe secret key")),
  STRIPE_WEBHOOK_SECRET: optional(z.string().regex(/^whsec_[A-Za-z0-9]+$/, "must be a Stripe webhook secret")),
  STRIPE_TAX: z.enum(["on", "off"]).default("off"),

  // Background jobs. Vercel Cron sends "Authorization: Bearer <CRON_SECRET>".
  CRON_SECRET: optional(z.string().min(32, "must be at least 32 characters")),
});

export type ServerEnv = z.infer<typeof serverEnvSchema>;

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  const result = serverEnvSchema.safeParse(source);
  if (!result.success) {
    // Report which settings are wrong, never their values.
    const names = result.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Invalid server environment variables: ${names}`);
  }
  return result.data;
}

let cached: ServerEnv | undefined;

export function serverEnv(): ServerEnv {
  // Tests change variables between cases, so don't cache there.
  if (process.env.NODE_ENV === "test") return parseServerEnv(process.env);
  cached ??= parseServerEnv(process.env);
  return cached;
}
