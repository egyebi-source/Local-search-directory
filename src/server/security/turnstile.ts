import "server-only";
import { z } from "zod";
import { serverEnv } from "@/server/env";

// Cloudflare's official always-pass test keys, used on previews until the
// real domain (and real keys) exist. Production requires real keys.
export const TEST_SITE_KEY = "1x00000000000000000000AA";
const TEST_SECRET_KEY = "1x0000000000000000000000000000000AA";

/** Local development only: skip the widget (this sandbox can't reach Cloudflare). */
export function turnstileBypassed(): boolean {
  const env = serverEnv();
  return env.NODE_ENV !== "production" && !env.VERCEL_ENV && process.env.TURNSTILE_DEV_BYPASS === "1";
}

export function turnstileSiteKey(): string {
  return process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || TEST_SITE_KEY;
}

function secretKey(): string | null {
  const env = serverEnv();
  if (env.TURNSTILE_SECRET_KEY) return env.TURNSTILE_SECRET_KEY;
  return env.VERCEL_ENV === "production" ? null : TEST_SECRET_KEY;
}

export async function verifyTurnstile(token: unknown, ip: string): Promise<boolean> {
  if (turnstileBypassed()) return true;
  const secret = secretKey();
  const parsed = z.string().min(1).max(2048).safeParse(token);
  if (!secret || !parsed.success) return false;
  try {
    const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: new URLSearchParams({ secret, response: parsed.data, remoteip: ip }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = z.object({ success: z.boolean() }).safeParse(await res.json());
    return body.success && body.data.success;
  } catch {
    return false;
  }
}
