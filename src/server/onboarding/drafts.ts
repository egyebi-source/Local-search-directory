import "server-only";
import { and, desc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { assessmentDrafts } from "@/server/db/schema";
import { randomToken, sha256Hex } from "@/server/security/hash";
import { draftSchema, type Draft } from "./answers";

export const DRAFT_TTL_HOURS = 24;
export const DRAFT_COOKIE = "tr_draft";
/** How long after asking for a sign-in link the email can still claim the draft. */
export const CLAIM_MINUTES = 30;

/** Same normalization Auth.js applies to the sign-in email. */
const emailHash = (email: string) => sha256Hex(`draft-email:${email.trim().toLowerCase()}`);

/** Store answers given before sign-up. Returns the token for the cookie. */
export async function saveDraft(answers: Draft): Promise<string> {
  const db = getDb();
  // Opportunistic cleanup so abandoned drafts don't pile up.
  await db.delete(assessmentDrafts).where(lt(assessmentDrafts.expiresAt, sql`now()`));
  const token = randomToken();
  await db.insert(assessmentDrafts).values({
    tokenHash: sha256Hex(token),
    answers,
    expiresAt: new Date(Date.now() + DRAFT_TTL_HOURS * 60 * 60 * 1000),
  });
  return token;
}

/** Read and delete a draft in one step, so it can be used only once. */
export async function consumeDraft(token: string): Promise<Draft | null> {
  const [row] = await getDb()
    .delete(assessmentDrafts)
    .where(eq(assessmentDrafts.tokenHash, sha256Hex(token)))
    .returning();
  if (!row || row.expiresAt <= new Date()) return null;
  // Re-validate: stored data is never trusted blindly.
  const parsed = draftSchema.safeParse(row.answers);
  return parsed.success ? parsed.data : null;
}

/**
 * Tag the visitor's draft with the email they're signing in with, so the
 * emailed link can finish sign-up even if it opens in a different browser.
 */
export async function claimDraft(token: string, email: string): Promise<void> {
  await getDb()
    .update(assessmentDrafts)
    .set({ emailHash: emailHash(email), claimedAt: sql`now()` })
    .where(and(eq(assessmentDrafts.tokenHash, sha256Hex(token)), gt(assessmentDrafts.expiresAt, sql`now()`)));
}

/**
 * Fallback when the draft cookie isn't in this browser: the most recent
 * draft claimed by this (now verified) email in the last CLAIM_MINUTES.
 * Read and deleted in one step, like consumeDraft.
 */
export async function consumeClaimedDraft(email: string): Promise<Draft | null> {
  const db = getDb();
  const recent = db
    .select({ tokenHash: assessmentDrafts.tokenHash })
    .from(assessmentDrafts)
    .where(
      and(
        eq(assessmentDrafts.emailHash, emailHash(email)),
        gt(assessmentDrafts.claimedAt, sql`now() - make_interval(mins => ${CLAIM_MINUTES})`),
        gt(assessmentDrafts.expiresAt, sql`now()`),
      ),
    )
    .orderBy(desc(assessmentDrafts.claimedAt))
    .limit(1);
  const [row] = await db.delete(assessmentDrafts).where(inArray(assessmentDrafts.tokenHash, recent)).returning();
  if (!row) return null;
  const parsed = draftSchema.safeParse(row.answers);
  return parsed.success ? parsed.data : null;
}
