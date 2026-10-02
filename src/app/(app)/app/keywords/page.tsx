import Link from "next/link";
import { CopyButton } from "../actions/client";
import { listActions } from "@/server/actions/plan";
import { loadSnapshots } from "@/server/dashboard/snapshot";
import { loadPlan, topicHistory, type Topic } from "@/server/keywords/plan";
import { withCurrentOrg } from "@/server/org/current";
import { addTopicAction } from "./actions";
import { BuildPlanButton } from "./client";

const num = (n: number) => n.toLocaleString("en-US");
const money = (n: number) => `$${n.toLocaleString("en-US")}`;
const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-CA", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });

const STATUS: Record<Topic["status"], { label: string; icon: string; cls: string; help: string }> = {
  aligned: { label: "Aligned", icon: "✓", cls: "bg-green-100 text-green-900", help: "You have a page for this and you're on page 1." },
  weak: { label: "Weak", icon: "◐", cls: "bg-gold-100 text-gold-900", help: "A page shows up, but it doesn't use these words or isn't on page 1 yet." },
  missing: { label: "Missing", icon: "✗", cls: "bg-red-100 text-red-900", help: "None of your pages show up for these searches." },
};

function TopicCard({ t, history, inPlan }: { t: Topic; history: ReturnType<typeof topicHistory>; inPlan: boolean }) {
  const s = STATUS[t.status];
  const first = history.find((h) => h.best !== null || h.inTop10 > 0) ?? history[0];
  const last = history.at(-1);
  const paying = new Set(t.keywords.flatMap((k) => k.adsBy ?? []));
  return (
    <li className="flex flex-col gap-4 rounded-xl bg-white p-5 ring-1 ring-slate-200">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold capitalize">{t.name}</h2>
          <p className="text-sm text-slate-600">
            {num(t.searches)} searches/month · worth about {money(t.valueUsd)}/month in ad clicks
            {paying.size ? ` · ${paying.size} competitor${paying.size === 1 ? "" : "s"} paying for ads` : ""}
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${s.cls}`} title={s.help}>
          {s.icon} {s.label}
        </span>
      </div>

      <p className="text-sm text-slate-700">
        {s.help}
        {t.page ? (
          <>
            {" "}
            Your page: <span className="break-all font-medium">{t.page.url}</span>
            {t.page.title ? <> (title: &ldquo;{t.page.title}&rdquo;)</> : null}
            {t.bestPosition ? `, best position #${t.bestPosition}` : ""}.
          </>
        ) : null}
      </p>

      {last && first && first.day !== last.day && (first.best !== null || last.best !== null) ? (
        <p className="text-sm">
          <span className="text-slate-600">Since {fmtDay(first.day)}: </span>
          best position {first.best === null ? "not ranked" : `#${first.best}`} → <strong>{last.best === null ? "not ranked" : `#${last.best}`}</strong> · searches on page 1: {first.inTop10} →{" "}
          <strong>{last.inTop10}</strong>
        </p>
      ) : null}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Searches in this topic</caption>
          <thead className="text-xs text-slate-600">
            <tr>
              <th scope="col" className="py-1.5 pr-3 font-medium">Search</th>
              <th scope="col" className="py-1.5 pr-3 text-right font-medium">Searches/mo</th>
              <th scope="col" className="py-1.5 pr-3 text-right font-medium">Ad cost/click</th>
              <th scope="col" className="py-1.5 pr-3 text-right font-medium">You</th>
              <th scope="col" className="py-1.5 font-medium">Who pays · who&apos;s top 3</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {t.keywords.slice(0, 8).map((k) => (
              <tr key={k.keyword}>
                <td className="py-1.5 pr-3">{k.keyword}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{num(k.searches)}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{k.cpcUsd ? `$${k.cpcUsd.toFixed(2)}` : "—"}</td>
                <td className="py-1.5 pr-3 text-right tabular-nums">{k.position ? `#${k.position}` : "—"}</td>
                <td className="py-1.5 text-xs text-slate-600">
                  {k.adsBy === null ? "not checked" : `${k.adsBy.length ? `Ads: ${k.adsBy.join(", ")}` : "No ads"}${k.top3?.length ? ` · Top 3: ${k.top3.join(", ")}` : ""}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {t.keywords.length > 8 ? <p className="mt-1 text-xs text-slate-500">+{t.keywords.length - 8} more searches in this topic</p> : null}
      </div>

      {t.change ? (
        <div className="flex flex-col gap-2 rounded-lg bg-slate-50 p-4 ring-1 ring-slate-200">
          <p className="font-semibold">The change to make: {t.change.title}</p>
          <p className="text-sm text-slate-700">{t.change.why}</p>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap font-sans text-sm text-slate-800">{t.change.content}</pre>
          <div className="flex flex-wrap items-center gap-2">
            <CopyButton text={t.change.content} />
            {inPlan ? (
              <Link href="/app/actions" className="text-sm font-medium text-green-700 underline">
                ✓ In your action plan
              </Link>
            ) : (
              <form action={addTopicAction}>
                <input type="hidden" name="topic" value={t.name} />
                <button type="submit" className="rounded-md bg-rose-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-800">
                  Add to my action plan
                </button>
              </form>
            )}
          </div>
        </div>
      ) : (
        <p className="text-sm text-green-800">Nothing to change here. Keep the page up to date and keep collecting reviews.</p>
      )}
    </li>
  );
}

export default async function KeywordPlanPage() {
  const { current, snapshots, actionTitles } = await withCurrentOrg(async (tx, ctx) => {
    const { open, done } = await listActions(tx, ctx.orgId);
    return {
      current: await loadPlan(tx, ctx.orgId),
      snapshots: await loadSnapshots(tx, ctx.orgId),
      actionTitles: new Set([...open, ...done].map((a) => a.title)),
    };
  });
  const plan = current?.plan;
  const count = (status: Topic["status"]) => plan?.topics.filter((t) => t.status === status).length ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Keyword plan</h1>
        <p className="max-w-3xl text-slate-600">
          What people type into Google to find a business like yours, which of those searches competitors pay for, whether your website
          matches each one, and exactly what to change.
        </p>
      </div>

      {!plan ? (
        <BuildPlanButton label="Build my keyword plan" />
      ) : plan.topics.length === 0 ? (
        <div className="flex max-w-3xl flex-col gap-3 rounded-xl bg-white p-5 ring-1 ring-slate-200">
          <p className="font-medium">We didn&apos;t find searches we&apos;re confident your customers type.</p>
          <p className="text-sm text-slate-600">
            We only show searches that match what you do, and we left out everything else (other trades, other cities, people looking
            for information rather than a business). This usually means the business type on file is very specific, or your customers
            find you by name or referral rather than by searching. Check the main service under{" "}
            <Link href="/app/team#details" className="underline">
              Team → Business details
            </Link>{" "}
            and rebuild.
          </p>
          <BuildPlanButton label="Rebuild my plan" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ["Searches a month", num(plan.totalSearches)],
              ["Worth in ad clicks / month", money(plan.totalValueUsd)],
              ["Topics aligned", `${count("aligned")} of ${plan.topics.length}`],
              ["Topics to fix", String(count("weak") + count("missing"))],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
                <p className="text-xs text-slate-600">{label}</p>
                <p className="mt-1 text-2xl font-semibold">{value}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-slate-500">
            Built {fmtDay(current!.builtOn)}. Search counts and costs are monthly estimates from Google Ads data. Positions update weekly.
            {current!.dataSource === "sandbox" ? " Sample data: not about your business." : ""}
          </p>
          <ol className="flex flex-col gap-4">
            {[...plan.topics]
              .sort((a, b) => ({ missing: 0, weak: 1, aligned: 2 })[a.status] - ({ missing: 0, weak: 1, aligned: 2 })[b.status] || b.valueUsd - a.valueUsd)
              .map((t) => (
                <TopicCard key={t.name} t={t} history={topicHistory(t, snapshots)} inPlan={Boolean(t.change && actionTitles.has(t.change.title))} />
              ))}
          </ol>
          <BuildPlanButton label="Rebuild my plan" />
        </>
      )}
    </div>
  );
}
