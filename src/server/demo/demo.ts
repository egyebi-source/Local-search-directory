import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { prospects, sessions, users } from "@/server/db/schema";
import { withUser } from "@/server/db/tenant";
import { randomToken, sha256Hex } from "@/server/security/hash";

// Demo mode (previews only): one-click entry as a fictional shop owner or
// as TorqueRank staff, on data seeded by scripts/seed-demo.mjs.

export const DEMO_EMAILS = { owner: "demo-owner@torquerank.test", admin: "demo-admin@torquerank.test" } as const;
export type DemoRole = keyof typeof DEMO_EMAILS;

/** Never true on production, whatever DEMO_MODE says. */
export function demoEnabled(env: Record<string, string | undefined> = process.env): boolean {
  if (env.DEMO_MODE !== "true") return false;
  if (env.VERCEL_ENV === "production") return false;
  return env.VERCEL_ENV === "preview" || (!env.VERCEL && env.NODE_ENV !== "production");
}

/** Demo accounts are marked in the UI so nobody mistakes them for real data. */
export const isDemoEmail = (email: string | null | undefined) => Boolean(email?.toLowerCase().endsWith("@torquerank.test"));

const DEMO_SESSION_HOURS = 8;

/** Create a short database session for a demo account. Returns the session token for the cookie. */
export async function createDemoSession(role: DemoRole): Promise<{ token: string; expires: Date } | null> {
  if (!demoEnabled()) return null;
  const [user] = await getDb().select({ id: users.id }).from(users).where(eq(users.email, DEMO_EMAILS[role]));
  if (!user) return null;
  const token = randomToken();
  const expires = new Date(Date.now() + DEMO_SESSION_HOURS * 60 * 60 * 1000);
  await getDb().insert(sessions).values({ sessionToken: token, userId: user.id, expires });
  return { token, expires };
}

/** A fresh claim link for one fictional, unclaimed demo shop. */
export async function demoClaimToken(): Promise<string | null> {
  if (!demoEnabled()) return null;
  const [admin] = await getDb().select({ id: users.id }).from(users).where(eq(users.email, DEMO_EMAILS.admin));
  if (!admin) return null;
  return withUser(admin.id, async (tx) => {
    const token = randomToken();
    const updated = await tx
      .update(prospects)
      .set({ tokenHash: sha256Hex(token), expiresAt: sql`now() + interval '60 days'` })
      .where(and(eq(prospects.domain, "lakeshoreautobody.test")))
      .returning({ id: prospects.id });
    return updated.length ? token : null;
  });
}
