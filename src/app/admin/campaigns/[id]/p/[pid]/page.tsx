import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/server/admin/guard";
import { loadProspect, pitchOpener } from "@/server/campaigns/outreach";
import { AnalyzeButton, ContactedButtons, CopyText, EmailComposer } from "./client";

export const metadata: Metadata = { title: "Business profile", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
// The deeper check reads their website and Google listing.
export const maxDuration = 60;

const rank = (n: number | null) => (n === null ? "Not in top 20" : `#${n}`);
const num = (n: number | null) => (n === null ? "—" : n.toLocaleString("en-US"));
const day = (d: Date | null) => (d ? d.toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric" }) : null);

function Stat({ label, value, note, bad }: { label: string; value: string; note?: string; bad?: boolean }) {
  return (
    <div className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
      <p className="text-xs text-slate-600">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${bad ? "text-red-700" : ""}`}>{value}</p>
      {note ? <p className="mt-1 text-xs text-slate-500">{note}</p> : null}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl bg-white p-5 ring-1 ring-slate-200">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default async function ProspectPage({ params }: { params: Promise<{ id: string; pid: string }> }) {
  const admin = await requireAdmin();
  const { id, pid } = await params;
  const v = z.object({ id: z.uuid(), pid: z.uuid() }).safeParse({ id, pid });
  if (!v.success) notFound();
  const p = await loadProspect(admin.id, v.data.pid);
  if (!p || p.campaignId !== v.data.id) notFound();
  const r = p.report;
  const a = p.analysis;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href={`/admin/campaigns/${p.campaignId}`} className="text-sm underline">
            ← {p.campaign.name}
          </Link>
          <h1 className="mt-2 text-2xl font-semibold">{p.businessName}</h1>
          <p className="text-sm text-slate-600">
            <a href={`https://${p.domain}`} target="_blank" rel="noopener noreferrer nofollow" className="underline">
              {p.domain}
            </a>{" "}
            · Search checked: &ldquo;{p.campaign.keyword}&rdquo;
          </p>
        </div>
        <p className="rounded-full bg-slate-100 px-3 py-1 text-sm">
          {p.status === "claimed" ? `Claimed ${day(p.claimedAt)}` : p.status === "opened" ? `Opened their report ${day(p.openedAt)}` : "Hasn't opened a report yet"}
          {p.contactedAt ? ` · Contacted by ${p.contactChannel} ${day(p.contactedAt)}` : ""}
        </p>
      </header>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Google Maps spot" value={rank(r.mapRank)} note="Top 3 get most calls" bad={r.mapRank === null || r.mapRank > 3} />
        <Stat label="Rating" value={r.rating === null ? "—" : `${r.rating.toFixed(1)}★`} note={`Top 3 average: ${r.leaderAvgRating ?? "—"}★`} bad={(r.rating ?? 5) < (r.leaderAvgRating ?? 0) - 0.1} />
        <Stat label="Google reviews" value={num(r.reviews)} note={`Top 3 average: ${num(r.leaderAvgReviews)}`} bad={(r.reviews ?? 0) < (r.leaderAvgReviews ?? 0)} />
        <Stat label="Google position" value={rank(r.organicRank)} bad={r.organicRank === null || r.organicRank > 3} />
      </div>

      <Section title="Contact">
        <dl className="grid gap-2 text-sm sm:grid-cols-[10rem_1fr]">
          <dt className="text-slate-600">Phone (Google listing)</dt>
          <dd>{p.phone ? <a href={`tel:${p.phone.replace(/[^\d+]/g, "")}`} className="font-medium underline">{p.phone}</a> : <span className="text-slate-500">Not found yet: run the deeper check.</span>}</dd>
          <dt className="text-slate-600">Email (their website)</dt>
          <dd>
            {p.email ? (
              <>
                <span className="font-medium">{p.email}</span>{" "}
                {p.emailSource ? (
                  <a href={p.emailSource} target="_blank" rel="noopener noreferrer nofollow" className="text-xs text-slate-500 underline">
                    found here
                  </a>
                ) : null}
              </>
            ) : (
              <span className="text-slate-500">{a ? "Their website doesn't publish an email. Call or visit instead." : "Not found yet: run the deeper check."}</span>
            )}
          </dd>
        </dl>
        <p className="text-xs text-slate-500">
          Google listings don&apos;t include emails, so we look for one the business publishes on its own website. We never guess or buy addresses.
        </p>
      </Section>

      <Section title="What we'd fix first">
        {a ? (
          <>
            {a.fixes.length ? (
              <ol className="flex flex-col gap-3">
                {a.fixes.map((f, i) => (
                  <li key={f.title} className="flex gap-3">
                    <span className="font-display text-xl italic text-gold-600">{i + 1}</span>
                    <span>
                      <span className="block font-medium">{f.title}</span>
                      <span className="block text-sm text-slate-600">{f.why}</span>
                    </span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="text-sm text-slate-600">Nothing stands out: this business is doing well. Probably not a priority prospect.</p>
            )}
            <p className="text-xs text-slate-500">
              Checked {a.checkedOn}. Homepage: {a.site.broken ? `didn't load${a.site.status ? ` (error ${a.site.status})` : ""}` : `“${a.site.title ?? "no title"}”`}. These fixes also appear on the business&apos;s own report.
            </p>
          </>
        ) : (
          <p className="text-sm text-slate-600">
            Run the deeper check to scan their website, find their phone and published email, and list the 3 fixes you&apos;ll lead with.
          </p>
        )}
        <AnalyzeButton campaignId={p.campaignId} prospectId={p.id} again={Boolean(a)} />
      </Section>

      <Section title="Call or visit">
        <p className="rounded-lg bg-gold-50 p-3 text-sm text-gold-950">{pitchOpener(p)}</p>
        <div className="flex flex-wrap gap-2">
          <CopyText text={pitchOpener(p)} label="Copy the opener" />
        </div>
        <p className="text-sm text-slate-600">After you reach them, log it:</p>
        <ContactedButtons campaignId={p.campaignId} prospectId={p.id} />
      </Section>

      <Section title="Email">
        {p.status === "claimed" ? (
          <p className="text-sm text-slate-600">They&apos;ve claimed their report and have an account. No outreach needed.</p>
        ) : (
          <>
            <p className="text-sm text-slate-600">
              Sends from your own email app, one business at a time, with their private report link. Canada&apos;s anti-spam law (CASL) allows
              this to a business email it publishes itself, when the message is about their business, says who you are with a mailing address,
              and offers a way to opt out. The draft includes all of that.
            </p>
            <EmailComposer campaignId={p.campaignId} prospectId={p.id} to={p.email} />
          </>
        )}
      </Section>
    </div>
  );
}
