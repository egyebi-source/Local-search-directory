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
  cached ??= parseServerEnv(process.env);
  return cached;
}
