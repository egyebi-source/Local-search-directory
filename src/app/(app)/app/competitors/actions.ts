"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  addCompetitor,
  addGapToActions,
  buildReport,
  CompetitorLimitError,
  InvalidDomainError,
  listCompetitors,
  loadReport,
  MAX_COMPETITORS,
  removeCompetitor,
  saveReport,
} from "@/server/competitors/competitors";
import { httpTransport } from "@/server/dataforseo/client";
import { organizations, type Country } from "@/server/db/schema";
import { serverEnv } from "@/server/env";
import { withCurrentOrg } from "@/server/org/current";
import { consumeRateLimit } from "@/server/security/rate-limit";
import { SpendCapReachedError } from "@/server/security/spend";

export type CompetitorState = { error?: string; ok?: string };

export async function addCompetitorAction(_prev: CompetitorState, form: FormData): Promise<CompetitorState> {
  const input = z.string().trim().min(3).max(253).safeParse(form.get("domain"));
  if (!input.success) return { error: "Enter a website like rivalshop.com." };
  try {
    const domain = await withCurrentOrg((tx, ctx) => addCompetitor(tx, ctx.orgId, input.data, form.get("source") === "suggested" ? "suggested" : "you"));
    revalidatePath("/app/competitors");
    return { ok: `Added ${domain}. Run a check to see how they get found.` };
  } catch (err) {
    if (err instanceof InvalidDomainError) return { error: "That isn't a valid competitor website (or it's your own)." };
    if (err instanceof CompetitorLimitError) return { error: `You can track up to ${MAX_COMPETITORS} competitors. Remove one first.` };
    throw err;
  }
}

export async function removeCompetitorAction(form: FormData): Promise<void> {
  const id = z.uuid().safeParse(form.get("id"));
  if (!id.success) return;
  await withCurrentOrg((tx, ctx) => removeCompetitor(tx, ctx.orgId, id.data));
  revalidatePath("/app/competitors");
}

export async function runCheckAction(): Promise<CompetitorState> {
  const setup = await withCurrentOrg(async (tx, ctx) => {
    const [org] = await tx.select({ domain: organizations.websiteDomain, country: organizations.country }).from(organizations).where(eq(organizations.id, ctx.orgId));
    return { orgId: ctx.orgId, userId: ctx.userId, domain: org?.domain ?? null, country: (org?.country ?? "CA") as Country, rivals: await listCompetitors(tx, ctx.orgId) };
  });
  if (!setup.domain) return { error: "Add your website first (Team → business details)." };
  // Each check costs a few cents of search data per site.
  if (!(await consumeRateLimit({ name: "competitor-check:org", limit: 3, windowSeconds: 24 * 60 * 60 }, setup.orgId))) {
    return { error: "You've run 3 checks today. Search data changes slowly; try again tomorrow." };
  }
  try {
    const report = await buildReport(httpTransport, setup.domain, setup.rivals.map((r) => r.domain), setup.country);
    await withCurrentOrg((tx, ctx) => saveReport(tx, ctx.orgId, serverEnv().DATAFORSEO_MODE, report));
  } catch (err) {
    if (err instanceof SpendCapReachedError) return { error: "Today's data budget is used up. Try again tomorrow." };
    console.warn("[competitors] check failed:", err instanceof Error ? err.name : "unknown");
    return { error: "We couldn't reach our data provider. Please try again in a few minutes." };
  }
  revalidatePath("/app/competitors");
  return { ok: "Done. Here's how your competitors get found." };
}

export async function addGapAction(form: FormData): Promise<void> {
  const keyword = z.string().trim().min(1).max(120).safeParse(form.get("keyword"));
  if (!keyword.success) return;
  await withCurrentOrg(async (tx, ctx) => {
    // Look the search up in the saved report; never trust details from the browser.
    const saved = await loadReport(tx, ctx.orgId);
    const row = saved?.report.gap.find((g) => g.keyword === keyword.data);
    if (row) await addGapToActions(tx, ctx.orgId, row);
  });
  revalidatePath("/app/competitors");
  revalidatePath("/app/actions");
}
