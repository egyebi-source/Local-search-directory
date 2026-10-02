import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { requireAdmin } from "@/server/admin/guard";
import { campaignProspects, listCampaigns, type ProspectReport } from "@/server/campaigns/campaigns";

export const metadata: Metadata = { title: "Campaign", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const rank = (n: number | null) => (n === null ? "—" : `#${n}`);

export default async function CampaignPage({ params }: PageProps<"/admin/campaigns/[id]">) {
  const admin = await requireAdmin();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const campaign = (await listCampaigns(admin.id)).find((c) => c.id === id.data);
  if (!campaign) notFound();
  const rows = await campaignProspects(admin.id, id.data);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">{campaign.name}</h1>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Search checked: &ldquo;{campaign.keyword}&rdquo; · {campaign.total} businesses · {campaign.opened} opened · {campaign.claimed} claimed
          </p>
        </div>
        <Link href="/admin/campaigns" className="text-sm underline">
          All campaigns
        </Link>
      </header>

      <section className="flex flex-col gap-2 rounded-xl bg-amber-50 p-5 text-amber-950 ring-1 ring-amber-200 dark:bg-amber-950 dark:text-amber-100 dark:ring-amber-800">
        <h2 className="font-semibold">Get the claim links</h2>
        <p className="text-sm">
          Downloads a spreadsheet (CSV) with each business and its private link, ready for letters, postcards (turn links into QR codes) or a
          member mailing. For security we don&apos;t store links: each download creates fresh ones and earlier links stop working. Links last 60 days.
        </p>
        <p className="text-sm">
          Canada&apos;s anti-spam law (CASL) restricts cold email. Prefer mail, phone, in person or a partner&apos;s own member channels, and get legal
          advice before emailing.
        </p>
        <form method="post" action={`/admin/campaigns/${id.data}/links`}>
          <button type="submit" className="mt-1 rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-amber-400">
            Download claim links (CSV)
          </button>
        </form>
      </section>

      <div className="overflow-x-auto rounded-xl ring-1 ring-slate-200 dark:ring-slate-800">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Businesses in this campaign</caption>
          <thead className="bg-slate-50 text-slate-600 dark:bg-slate-900 dark:text-slate-400">
            <tr>
              {["Maps spot", "Business", "Rating", "Reviews", "Google position", "Status"].map((h) => (
                <th key={h} scope="col" className="px-3 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((p) => {
              const r = p.report as ProspectReport;
              return (
                <tr key={p.id}>
                  <td className="px-3 py-2 tabular-nums">{rank(r.mapRank)}</td>
                  <td className="px-3 py-2">
                    <p className="font-medium">{p.businessName}</p>
                    <p className="text-xs text-slate-500">{p.domain}</p>
                  </td>
                  <td className="px-3 py-2 tabular-nums">{r.rating === null ? "—" : `${r.rating.toFixed(1)}★`}</td>
                  <td className="px-3 py-2 tabular-nums">{r.reviews?.toLocaleString("en-US") ?? "—"}</td>
                  <td className="px-3 py-2 tabular-nums">{rank(r.organicRank)}</td>
                  <td className="px-3 py-2 text-xs">
                    {p.status === "claimed" ? (
                      <span className="font-semibold text-green-700 dark:text-green-400">Claimed</span>
                    ) : p.status === "opened" ? (
                      "Opened"
                    ) : (
                      "Not opened"
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
