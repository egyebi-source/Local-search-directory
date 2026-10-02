"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { t } from "@/lib/i18n/en";
import { httpTransport } from "@/server/dataforseo/client";
import { organizations, type Country } from "@/server/db/schema";
import { withOrg } from "@/server/db/tenant";
import { serverEnv } from "@/server/env";
import { withCurrentOrg } from "@/server/org/current";
import { consumeRateLimit } from "@/server/security/rate-limit";
import { SpendCapReachedError } from "@/server/security/spend";
import {
  addTrackedSearch,
  keywordSchema,
  runChecksForOrg,
  stopTracking,
  TRACKED_SEARCH_LIMIT,
  TrackingLimitError,
} from "@/server/tracking/checks";
import { addChange, ChangeDateError, changeSchema, deleteChange } from "@/server/tracking/progress";

export type ProgressState = { error?: string; ok?: string };

const DAY = 24 * 60 * 60;
const idSchema = z.uuid();
const done = (ok?: string): ProgressState => {
  revalidatePath("/app/progress");
  return ok ? { ok } : {};
};

/** Run today's check now (each search is still checked at most once a day). */
export async function checkNowAction(): Promise<ProgressState> {
  const ctx = await withCurrentOrg(async (_tx, ctx) => ctx);
  if (!(await consumeRateLimit({ name: "progress-check:org", limit: 5, windowSeconds: DAY }, ctx.orgId))) {
    return { error: t.progress.checkBusy };
  }
  try {
    const r = await runChecksForOrg(
      ctx.orgId,
      (fn) => withOrg(ctx.userId, ctx.orgId, fn),
      { dataforseo: httpTransport, dataSource: serverEnv().DATAFORSEO_MODE },
      "manual",
    );
    if (r.failed > 0 && r.checked === 0) return { error: t.progress.checkFailed };
    return done(t.progress.checked(r.checked));
  } catch (err) {
    if (err instanceof SpendCapReachedError) return { error: t.progress.checkBusy };
    throw err;
  }
}

export async function addSearchAction(_prev: ProgressState, form: FormData): Promise<ProgressState> {
  const keyword = keywordSchema.safeParse(form.get("keyword"));
  if (!keyword.success) return { error: t.progress.invalidKeyword };
  try {
    await withCurrentOrg(async (tx, ctx) => {
      if (!(await consumeRateLimit({ name: "progress-add:org", limit: 20, windowSeconds: DAY }, ctx.orgId))) {
        throw new TrackingLimitError();
      }
      const [org] = await tx.select({ country: organizations.country }).from(organizations).where(eq(organizations.id, ctx.orgId));
      await addTrackedSearch(tx, ctx.orgId, keyword.data, (org?.country ?? "CA") as Country);
    });
  } catch (err) {
    if (err instanceof TrackingLimitError) return { error: t.progress.limit(TRACKED_SEARCH_LIMIT) };
    throw err;
  }
  return done();
}

export async function stopTrackingAction(form: FormData): Promise<void> {
  const id = idSchema.safeParse(form.get("id"));
  if (!id.success) return;
  await withCurrentOrg((tx, ctx) => stopTracking(tx, ctx.orgId, id.data));
  done();
}

export async function addChangeAction(_prev: ProgressState, form: FormData): Promise<ProgressState> {
  const parsed = changeSchema.safeParse({
    title: form.get("title"),
    note: form.get("note") ?? "",
    madeOn: form.get("madeOn"),
  });
  if (!parsed.success) return { error: t.progress.invalidChange };
  try {
    await withCurrentOrg((tx, ctx) => addChange(tx, ctx, parsed.data));
  } catch (err) {
    if (err instanceof ChangeDateError) return { error: t.progress.invalidChange };
    throw err;
  }
  return done();
}

export async function deleteChangeAction(form: FormData): Promise<void> {
  const id = idSchema.safeParse(form.get("id"));
  if (!id.success) return;
  await withCurrentOrg((tx, ctx) => deleteChange(tx, ctx.orgId, id.data));
  done();
}
