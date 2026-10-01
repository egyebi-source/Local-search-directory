import "server-only";
import { serverEnv } from "./env";

/**
 * Absolute base URL for links in emails. Built only from configuration,
 * never from request headers, so a forged Host header can't redirect an
 * invite link to an attacker's site.
 */
export function appBaseUrl(): string {
  const env = serverEnv();
  if (env.AUTH_URL) return env.AUTH_URL.replace(/\/+$/, "");
  if (env.VERCEL_ENV === "production" && env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (env.VERCEL_URL) return `https://${env.VERCEL_URL}`;
  return "http://localhost:3000";
}
