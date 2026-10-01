import "server-only";
import { eq, lt, sql } from "drizzle-orm";
import { getDb } from "@/server/db/client";
import { assessmentDrafts } from "@/server/db/schema";
import { randomToken, sha256Hex } from "@/server/security/hash";
import { draftSchema, type Draft } from "./answers";

export const DRAFT_TTL_HOURS = 24;
export const DRAFT_COOKIE = "tr_draft";

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
