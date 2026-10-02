import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { listActions } from "@/server/actions/plan";
import { getDb } from "@/server/db/client";
import { digestSends, memberships, organizations, users } from "@/server/db/schema";
import { withSystemOrg, type Tx } from "@/server/db/tenant";
import { escapeHtml, sendEmail } from "@/server/email/send";
import { serverEnv } from "@/server/env";
import { checkOn, countGain, loadProgress, rankGain, type Check } from "@/server/tracking/progress";
import { appBaseUrl } from "@/server/url";

// Weekly progress email (PRD FR-12.7): what moved in the last 7 days, the
// changes logged, and the next thing to do. Plain facts from the org's own
// data; no AI, no competitor names.

export type Digest = {
  subject: string;
  lines: { label: string; text: string; good: boolean | null }[];
  changes: string[];
  next: { title: string; why: string } | null;
  businessName: string;
};

const rank = (n: number | null | undefined) => (n === null || n === undefined ? "not in top 20" : `#${n}`);
const arrow = (gain: number | null) => (gain === null || gain === 0 ? "" : gain > 0 ? ` (up ${gain})` : ` (down ${-gain})`);

function weekAgo(day: string) {
  return new Date(new Date(`${day}T12:00:00Z`).getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
}

export async function buildDigest(tx: Tx, orgId: string): Promise<Digest | null> {
  const [org] = await tx.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, orgId));
  if (!org) return null;
  const { searches, changes } = await loadProgress(tx, orgId);
  const tracked = searches.filter((s) => s.history.length >= 2);
  if (!tracked.length) return null;

  const lines: Digest["lines"] = [];
  let headline: string | null = null;
  for (const s of tracked) {
    const now = s.now as Check;
    const then = checkOn(s.history, weekAgo(now.day)) ?? s.history[0];
    const map = rankGain(then.mapRank, now.mapRank);
    const org2 = rankGain(then.organicRank, now.organicRank);
    lines.push({
      label: `"${s.keyword}"`,
      text: `Google Maps ${rank(then.mapRank)} → ${rank(now.mapRank)}${arrow(map)} · Google ${rank(then.organicRank)} → ${rank(now.organicRank)}${arrow(org2)}`,
      good: map === null || map === 0 ? null : map > 0,
    });
    if (!headline && map) headline = `Google Maps ${rank(then.mapRank)} → ${rank(now.mapRank)} for "${s.keyword}"`;
  }
  const main = tracked[0];
  const then = checkOn(main.history, weekAgo(main.now!.day)) ?? main.history[0];
  const newReviews = countGain(then.reviews, main.now!.reviews);
  if (main.now!.reviews !== null) {
    lines.push({
      label: "Google reviews",
      text: `${main.now!.reviews}${newReviews ? ` (${newReviews > 0 ? "+" : ""}${newReviews} this week)` : ""}; top 3 average ${main.now!.leaderAvgReviews ?? "—"}`,
      good: newReviews === null || newReviews === 0 ? null : newReviews > 0,
    });
  }

  const since = weekAgo(main.now!.day);
  const { open } = await listActions(tx, orgId);
  const name = org.name.replace(/\s*\(Demo\)$/, "");
  return {
    businessName: name,
    subject: headline ? `${name}: ${headline} this week` : `${name}: your weekly Google report`,
    lines,
    changes: changes.filter((c) => c.madeOn > since).map((c) => c.title),
    next: open[0] ? { title: open[0].title, why: open[0].why } : null,
  };
}

// --- Unsubscribe links: HMAC of the user id, so they can't be forged or guessed.

function signature(userId: string): string {
  const secret = serverEnv().AUTH_SECRET;
  if (!secret) throw new Error("AUTH_SECRET is required to sign unsubscribe links");
  return createHmac("sha256", secret).update(`digest-unsubscribe:${userId}`).digest("base64url");
}

export function unsubscribeUrl(userId: string): string {
  return `${appBaseUrl()}/unsubscribe?u=${encodeURIComponent(userId)}&s=${signature(userId)}`;
}

export function verifyUnsubscribe(userId: string, sig: string): boolean {
  if (!/^[0-9a-f-]{36}$/i.test(userId) || !/^[A-Za-z0-9_-]{43}$/.test(sig)) return false;
  const a = Buffer.from(signature(userId));
  const b = Buffer.from(sig);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function unsubscribe(userId: string): Promise<void> {
  await getDb().update(users).set({ weeklyDigest: false }).where(eq(users.id, userId));
}

export function renderDigest(d: Digest, links: { progress: string; unsubscribe: string }): { text: string; html: string } {
  const text = [
    `Your week on Google: ${d.businessName}`,
    "",
    ...d.lines.map((l) => `${l.label}: ${l.text}`),
    "",
    d.changes.length ? `Changes you logged this week:\n${d.changes.map((c) => `- ${c}`).join("\n")}` : "No changes logged this week.",
    "",
    d.next ? `Your next step: ${d.next.title}\n${d.next.why}` : "",
    "",
    `See your progress: ${links.progress}`,
    "",
    `Don't want these weekly emails? ${links.unsubscribe}`,
  ].join("\n");
  const color = (g: boolean | null) => (g === null ? "#52514e" : g ? "#006300" : "#b42318");
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;color:#0b0b0b">
<h1 style="font-size:20px">Your week on Google: ${escapeHtml(d.businessName)}</h1>
<table style="width:100%;border-collapse:collapse;font-size:14px">${d.lines
    .map(
      (l) =>
        `<tr><td style="padding:6px 0;color:#52514e;vertical-align:top;width:40%">${escapeHtml(l.label)}</td><td style="padding:6px 0;color:${color(l.good)}">${escapeHtml(l.text)}</td></tr>`,
    )
    .join("")}</table>
${d.changes.length ? `<p style="font-size:14px"><strong>Changes you logged this week</strong></p><ul style="font-size:14px">${d.changes.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ul>` : ""}
${d.next ? `<p style="font-size:14px"><strong>Your next step:</strong> ${escapeHtml(d.next.title)}<br><span style="color:#52514e">${escapeHtml(d.next.why)}</span></p>` : ""}
<p><a href="${escapeHtml(links.progress)}" style="display:inline-block;background:#f59e0b;color:#0b0b0b;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:600">See your progress</a></p>
<p style="font-size:12px;color:#898781">You get this because you own ${escapeHtml(d.businessName)} on TorqueRank. <a href="${escapeHtml(links.unsubscribe)}" style="color:#898781">Stop these emails</a>.</p>
</div>`;
  return { text, html };
}

const week = sql`date_trunc('week', now() AT TIME ZONE 'UTC')::date`;
/** Demo and test addresses can't receive mail. */
const deliverable = (email: string) => !/\.(test|example|invalid|localhost)$/i.test(email.split("@")[1] ?? "");

/** The weekly job. Each org is claimed for the week before sending, so a re-run never double-sends. */
export async function runWeeklyDigest(send = sendEmail, budgetMs = 45_000, maxOrgs = 100) {
  const started = Date.now();
  const due = await getDb().execute<{ id: string }>(sql`SELECT orgs_due_for_digest(${maxOrgs}) AS id`);
  let orgs = 0;
  let sent = 0;
  for (const { id } of due.rows) {
    if (Date.now() - started > budgetMs) break;
    const job = await withSystemOrg(id, async (tx) => {
      const claimed = await tx.insert(digestSends).values({ orgId: id, week: sql`${week}` }).onConflictDoNothing().returning();
      if (!claimed.length) return null;
      const digest = await buildDigest(tx, id);
      const owners = await tx
        .select({ id: users.id, email: users.email })
        .from(memberships)
        .innerJoin(users, eq(users.id, memberships.userId))
        .where(and(eq(memberships.orgId, id), eq(memberships.role, "owner"), eq(users.weeklyDigest, true)));
      return digest ? { digest, owners: owners.filter((o) => deliverable(o.email)) } : null;
    });
    if (!job) continue;
    orgs++;
    let count = 0;
    for (const o of job.owners) {
      const unsub = unsubscribeUrl(o.id);
      const body = renderDigest(job.digest, { progress: `${appBaseUrl()}/app/progress`, unsubscribe: unsub });
      try {
        await send({
          to: o.email,
          subject: job.digest.subject,
          ...body,
          headers: { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
        });
        count++;
      } catch (err) {
        console.warn("[digest] send failed:", err instanceof Error ? err.name : "unknown");
      }
    }
    await withSystemOrg(id, (tx) => tx.update(digestSends).set({ recipients: count }).where(and(eq(digestSends.orgId, id), eq(digestSends.week, sql`${week}`))));
    sent += count;
  }
  return { due: due.rows.length, orgs, sent };
}
