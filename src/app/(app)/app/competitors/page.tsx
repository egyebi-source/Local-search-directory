import { eq } from "drizzle-orm";
import { Button } from "@/components/ui/button";
import { competitorNote, listCompetitors, loadReport, MAX_COMPETITORS, type SiteSummary } from "@/server/competitors/competitors";
import { organizations } from "@/server/db/schema";
import { withCurrentOrg } from "@/server/org/current";
import { addGapAction, removeCompetitorAction } from "./actions";
import { AddCompetitorForm, AddSuggestedButton, RunCheckButton } from "./client";

// A competitor check calls DataForSEO for up to 6 sites at once.
export const maxDuration = 60;

const num = (n: number | null) => (n === null ? "—" : n.toLocaleString("en-US"));
const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

function Card({ title, children, note }: { title: string; children: React.ReactNode; note?: string }) {
  return (
    <section className="flex flex-col gap-4 rounded-xl bg-white p-5 ring-1 ring-slate-200">
      <h2 className="text-lg font-semibold">{title}</h2>
      {children}
      {note ? (
        <p className="rounded-lg bg-gold-50 px-3 py-2 text-sm text-gold-950">
          <span className="font-semibold">What this means: </span>
          {note}
        </p>
      ) : null}
    </section>
  );
}

function SiteRow({ s, you = false }: { s: SiteSummary; you?: boolean }) {
  return (
    <tr className={`border-t border-slate-100 ${you ? "bg-rose-50/50 font-medium" : ""}`}>
      <td className="py-2 pr-3 break-all">{you ? `${s.domain} (you)` : s.domain}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{s.ok ? num(s.trafficEst) : "Couldn't check"}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{num(s.keywords)}</td>
      <td className="py-2 pr-3 text-right tabular-nums">{num(s.top10)}</td>
      <td className="py-2 text-right">{s.paidKeywords === null ? "—" : s.paidKeywords > 0 ? `Yes (${num(s.paidKeywords)} searches)` : "No"}</td>
    </tr>
  );
}

export default async function CompetitorsPage() {
  const { list, saved, domain } = await withCurrentOrg(async (tx, ctx) => {
    const [org] = await tx.select({ domain: organizations.websiteDomain }).from(organizations).where(eq(organizations.id, ctx.orgId));
    return { list: await listCompetitors(tx, ctx.orgId), saved: await loadReport(tx, ctx.orgId), domain: org?.domain ?? null };
  });
  const r = saved?.report;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Competitors</h1>
        <p className="mt-1 max-w-3xl text-slate-700">
          How your competitors get found on Google: how many visitors they get, the exact searches bringing them customers, whether they pay for
          ads, and the searches they win that you don&apos;t.
        </p>
      </div>

      <Card title={`Who you're watching (${list.length} of ${MAX_COMPETITORS})`}>
        {list.length ? (
          <ul className="flex flex-col divide-y divide-slate-100">
            {list.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-2">
                <span className="break-all">
                  {c.domain}
                  {c.source === "suggested" ? <span className="ml-2 text-xs text-slate-500">suggested by Google overlap</span> : null}
                </span>
                <form action={removeCompetitorAction}>
                  <input type="hidden" name="id" value={c.id} />
                  <Button type="submit" size="sm" variant="ghost">
                    Remove
                  </Button>
                </form>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-slate-600">Add the websites of businesses you lose customers to. Not sure? Run a check and we&apos;ll suggest them.</p>
        )}
        {list.length < MAX_COMPETITORS ? <AddCompetitorForm /> : null}
        {domain ? (
          <RunCheckButton hasReport={Boolean(r)} />
        ) : (
          <p className="text-sm text-red-700">Your business has no website on file, so there&apos;s nothing to compare yet.</p>
        )}
        {saved ? (
          <p className="text-xs text-slate-500">
            Last check: {fmtDay(saved.takenOn)}
            {saved.dataSource === "sandbox" ? " · sample data, not about your business" : ""}
          </p>
        ) : null}
      </Card>

      {r ? (
        <>
          <Card title="Who gets found on Google" note={competitorNote(r)}>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="text-xs text-slate-600">
                  <tr>
                    <th className="py-1 pr-3 font-medium">Website</th>
                    <th className="py-1 pr-3 text-right font-medium">Visitors from Google / month (est.)</th>
                    <th className="py-1 pr-3 text-right font-medium">Searches they rank for</th>
                    <th className="py-1 pr-3 text-right font-medium">On page 1</th>
                    <th className="py-1 text-right font-medium">Pays for Google ads</th>
                  </tr>
                </thead>
                <tbody>
                  <SiteRow s={r.you} you />
                  {r.rivals.map((s) => (
                    <SiteRow key={s.domain} s={s} />
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {r.rivals.length ? (
            <Card title="How customers find them">
              <div className="grid gap-5 lg:grid-cols-2">
                {[r.you, ...r.rivals].map((s, i) => (
                  <div key={s.domain} className="min-w-0">
                    <p className="mb-2 text-sm font-semibold break-all">
                      {s.domain}
                      {i === 0 ? " (you)" : ""}
                    </p>
                    {s.topSearches.length ? (
                      <table className="w-full text-left text-sm">
                        <thead className="text-xs text-slate-600">
                          <tr>
                            <th className="py-1 pr-2 font-medium">Search</th>
                            <th className="py-1 pr-2 text-right font-medium">Position</th>
                            <th className="py-1 text-right font-medium">Searches/mo</th>
                          </tr>
                        </thead>
                        <tbody>
                          {s.topSearches.slice(0, 8).map((k) => (
                            <tr key={k.keyword} className="border-t border-slate-100">
                              <td className="py-1.5 pr-2 break-words">{k.keyword}</td>
                              <td className="py-1.5 pr-2 text-right tabular-nums">#{k.position}</td>
                              <td className="py-1.5 text-right tabular-nums">{num(k.searches)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <p className="text-sm text-slate-500">{s.ok ? "No searches found in Google's top 100 (besides their own name)." : "Couldn't check this time."}</p>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          ) : null}

          <Card
            title="Searches they win and you don't"
            note={
              r.gap.length
                ? "Each of these brings customers to a competitor today. A page on your site built around the exact words is how you take a share. Add the best ones to your action plan."
                : r.rivals.length
                  ? "No clear gaps right now: your competitors aren't on page 1 for searches you're missing."
                  : "Add at least one competitor and run a check to see the searches they win."
            }
          >
            {r.gap.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-left text-sm">
                  <thead className="text-xs text-slate-600">
                    <tr>
                      <th className="py-1 pr-3 font-medium">Search</th>
                      <th className="py-1 pr-3 text-right font-medium">Searches/mo</th>
                      <th className="py-1 pr-3 text-right font-medium">Ad cost/click</th>
                      <th className="py-1 pr-3 font-medium">Who wins it</th>
                      <th className="py-1 pr-3 text-right font-medium">You</th>
                      <th className="py-1 font-medium">
                        <span className="sr-only">Action</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.gap.slice(0, 20).map((g) => (
                      <tr key={g.keyword} className="border-t border-slate-100">
                        <td className="py-2 pr-3 break-words">{g.keyword}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{num(g.searches)}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{g.cpcUsd > 0 ? `$${g.cpcUsd.toFixed(2)}` : "—"}</td>
                        <td className="py-2 pr-3 break-all">
                          {g.competitor} <span className="text-slate-500">#{g.theirPosition}</span>
                        </td>
                        <td className="py-2 pr-3 text-right tabular-nums">{g.yourPosition === null ? "—" : `#${g.yourPosition}`}</td>
                        <td className="py-2 text-right">
                          <form action={addGapAction}>
                            <input type="hidden" name="keyword" value={g.keyword} />
                            <Button type="submit" size="sm" variant="outline">
                              Add to plan
                            </Button>
                          </form>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </Card>

          {r.suggestions.length ? (
            <Card title="Google thinks these are also your competitors" note="They rank for many of the same searches you do. Track the ones that sell to the same customers.">
              <ul className="flex flex-col divide-y divide-slate-100">
                {r.suggestions.map((s) => (
                  <li key={s.domain} className="flex items-center justify-between gap-3 py-2">
                    <span className="break-all">
                      {s.domain} <span className="text-xs text-slate-500">{num(s.sharedSearches)} searches in common</span>
                    </span>
                    {list.length < MAX_COMPETITORS ? <AddSuggestedButton domain={s.domain} /> : null}
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
