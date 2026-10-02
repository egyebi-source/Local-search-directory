import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/server/admin/guard";
import { listCampaigns } from "@/server/campaigns/campaigns";
import { CreateCampaignForm } from "./create-form";

export const metadata: Metadata = { title: "Campaigns", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const admin = await requireAdmin();
  const rows = await listCampaigns(admin.id);
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-8 px-4 py-8">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Claim-your-ranking campaigns</h1>
        <Link href="/admin" className="text-sm underline">
          Admin home
        </Link>
      </header>
      <section className="flex flex-col gap-3 rounded-xl bg-white p-5 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
        <h2 className="text-lg font-semibold">New campaign</h2>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          We look up who shows in Google Maps for the business type in that city (about 1 cent for the whole city) and prepare a private
          report and claim link for each business with a website. Businesses that opted out are skipped automatically.
        </p>
        <CreateCampaignForm />
      </section>
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Campaigns</h2>
        {rows.length === 0 ? (
          <p className="text-sm text-slate-500">No campaigns yet.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/admin/campaigns/${c.id}`}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-4 py-3 ring-1 ring-slate-200 hover:ring-slate-400 dark:bg-slate-900 dark:ring-slate-800"
                >
                  <span>
                    <span className="font-medium">{c.name}</span>{" "}
                    <span className="text-xs text-slate-500">
                      {c.country} · {new Date(c.createdAt).toLocaleDateString("en-CA")}
                      {c.dataSource === "sandbox" ? " · sample data" : ""}
                    </span>
                  </span>
                  <span className="text-sm tabular-nums text-slate-600 dark:text-slate-400">
                    {c.total} businesses · {c.opened} opened · {c.claimed} claimed
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
