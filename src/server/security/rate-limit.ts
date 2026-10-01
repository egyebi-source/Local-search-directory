import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { sha256Hex } from "./hash";

export type RateLimitRule = { name: string; limit: number; windowSeconds: number };

// Limits for actions that send email or cost money (security checklist §13).
export const RATE_LIMITS = {
  loginEmailPerAddress: { name: "login-email:addr", limit: 5, windowSeconds: 60 * 60 },
  loginEmailPerIp: { name: "login-email:ip", limit: 20, windowSeconds: 60 * 60 },
  invitePerOrg: { name: "invite:org", limit: 20, windowSeconds: 24 * 60 * 60 },
} satisfies Record<string, RateLimitRule>;

/**
 * Fixed-window counter stored in Postgres. Returns false once `limit` is
 * exceeded within the window. The identifier is hashed before storage.
 */
export async function consumeRateLimit(rule: RateLimitRule, identifier: string): Promise<boolean> {
  const key = sha256Hex(`${rule.name}:${identifier.toLowerCase()}`);
  const result = await getDb().execute<{ count: number }>(sql`
    INSERT INTO rate_limits (key, window_start, count)
    VALUES (${key}, now(), 1)
    ON CONFLICT (key) DO UPDATE SET
      count = CASE
        WHEN rate_limits.window_start <= now() - make_interval(secs => ${rule.windowSeconds})
        THEN 1 ELSE rate_limits.count + 1 END,
      window_start = CASE
        WHEN rate_limits.window_start <= now() - make_interval(secs => ${rule.windowSeconds})
        THEN now() ELSE rate_limits.window_start END
    RETURNING count
  `);
  return Number(result.rows[0]?.count ?? Infinity) <= rule.limit;
}
