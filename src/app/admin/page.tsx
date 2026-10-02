import type { Metadata } from "next";
import Link from "next/link";
import { accessState } from "@/server/billing/access";
import { adminAgencies, adminAuditRecent, adminCustomers, adminOverview, adminPeople, type PersonRow } from "@/server/admin/admin";
import { requireAdmin } from "@/server/admin/guard";
import { isDemoEmail } from "@/server/demo/demo";
import type { PlanStatus } from "@/server/db/schema";
import { ExtendTrialForm } from "./extend-form";
import { PricingForm } from "./pricing-form";
import { getPricing, monthsFree, usd as price } from "@/server/billing/pricing";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

const usd = (micros: number) => `$${(micros / 1_000_000).toFixed(2)}`;
const day = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-CA") : "—");

function status(planStatus: string, trialEndsAt: string): string {
  const s = accessState({ planStatus: planStatus as PlanStatus, trialEndsAt: new Date(trialEndsAt) });
  return s.kind === "trialing" ? `trial · ${s.daysLeft}d left` : s.kind;
}

const ROLE: Record<string, string> = { owner: "owner", member: "member", agency: "via agency", staff: "staff" };
const list = (xs: { name: string; role: string }[]) =>
  xs.length ? xs.map((x) => `${x.name} (${ROLE[x.role] ?? x.role})`).join(", ") : "—";

/** Where someone is in setting up, in plain words. */
function stage(u: PersonRow): string {
  if (u.agencies.length) return "Agency";
  if (u.businesses.length) return "Business account";
  return "Signed in, nothing set up yet";
}

function Tile({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl bg-white p-4 ring-1 ring-slate-200">
      <p className="text-xs text-slate-600">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

// Staff only. Non-admins get a 404 from requireAdmin().
export default async function AdminPage() {
  const admin = await requireAdmin();
  const [o, customers, audit, p, people, agencies] = await Promise.all([
    adminOverview(admin.id),
    adminCustomers(admin.id),
    adminAuditRecent(admin.id),
    getPricing(),
    adminPeople(admin.id),
    adminAgencies(admin.id),
  ]);
  const dollars = (c: number) => (c / 100).toFixed(2);
  const spend = Object.values(o.spend_today).reduce((a, b) => a + Number(b), 0);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-10 px-4 py-8">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">TorqueRank admin</h1>
        <nav className="flex gap-4 text-sm">
          <Link href="/admin/campaigns" className="underline">
            Campaigns
          </Link>
          <Link href="/app" className="underline">
            Back to app
          </Link>
        </nav>
      </header>

      {isDemoEmail(admin.email) ? (
        <p className="rounded-lg border border-rose-300 bg-rose-50 px-4 py-2 text-sm text-rose-950">
          Demo admin: you&apos;re seeing the preview database, including the fictional demo shop and campaign.{" "}
          <Link href="/demo" className="underline">
            Back to the demo menu
          </Link>
        </p>
      ) : null}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Funnel</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-5 lg:grid-cols-9">
          <Tile label="Assessments (30 days)" value={o.assessments_30d} />
          <Tile label="People signed up" value={people.length} />
          <Tile label="Businesses" value={o.orgs_total} />
          <Tile label="Agencies" value={agencies.length} />
          <Tile label="In trial" value={o.orgs_trialing} />
          <Tile label="Paying" value={o.orgs_active} />
          <Tile label="Locked" value={o.orgs_locked} />
          <Tile label="Tracking searches" value={o.orgs_tracking} />
          <Tile label="Logged a change" value={o.orgs_logged_change} />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Operations today</h2>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <Tile label="Progress checks run" value={o.checks_today} />
          <Tile label="API spend" value={usd(spend)} />
          <Tile label="DataForSEO" value={usd(Number(o.spend_today.dataforseo ?? 0))} />
          <Tile label="Gemini" value={usd(Number(o.spend_today.gemini ?? 0))} />
        </div>
        <div className="overflow-x-auto rounded-xl ring-1 ring-slate-200">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Last 14 days</caption>
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">Day</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Assessments</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">New businesses</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">API spend</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {o.daily.map((d) => (
                <tr key={d.day}>
                  <td className="px-3 py-1.5">{d.day}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{d.assessments}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{d.signups}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{usd(Number(d.spend_micros))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">People ({people.length})</h2>
        <p className="text-sm text-slate-600">Everyone who has signed in at least once, newest first, and where they are in setting up.</p>
        <div className="overflow-x-auto rounded-xl ring-1 ring-slate-200">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">People</caption>
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                {["Person", "Signed up", "Last active", "Stage", "Businesses", "Agencies"].map((h) => (
                  <th key={h} scope="col" className="px-3 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {people.map((u) => (
                <tr key={u.id} className="align-top">
                  <td className="px-3 py-2">
                    <p className="font-medium break-all">{u.email}</p>
                    {u.name ? <p className="text-xs text-slate-500">{u.name}</p> : null}
                    {u.is_admin ? <p className="text-xs font-medium text-rose-700">Admin</p> : null}
                  </td>
                  <td className="px-3 py-2 text-xs">{day(u.created_at)}</td>
                  <td className="px-3 py-2 text-xs">{u.last_active ? day(u.last_active) : "—"}</td>
                  <td className="px-3 py-2 text-xs">{stage(u)}</td>
                  <td className="px-3 py-2 text-xs">{list(u.businesses)}</td>
                  <td className="px-3 py-2 text-xs">{list(u.agencies)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Agencies ({agencies.length})</h2>
        {agencies.length ? (
          <div className="overflow-x-auto rounded-xl ring-1 ring-slate-200">
            <table className="w-full text-left text-sm">
              <caption className="sr-only">Agencies</caption>
              <thead className="bg-slate-50 text-slate-600">
                <tr>
                  {["Agency", "Owner", "Status", "Started", "Team", "Locations"].map((h) => (
                    <th key={h} scope="col" className="px-3 py-2 font-medium">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {agencies.map((a) => (
                  <tr key={a.id}>
                    <td className="px-3 py-2 font-medium">{a.name}</td>
                    <td className="px-3 py-2 text-xs break-all">{a.owner_email ?? "—"}</td>
                    <td className="px-3 py-2 text-xs">{status(a.plan_status, a.trial_ends_at)}</td>
                    <td className="px-3 py-2 text-xs">{day(a.created_at)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{a.members}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{a.locations}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-slate-600">No agencies yet.</p>
        )}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Businesses ({customers.length})</h2>
        <p className="text-sm text-slate-600">
          Business details and status only. Customers&apos; Google data is never shown here. Every action is logged with your reason.
        </p>
        <div className="overflow-x-auto rounded-xl ring-1 ring-slate-200">
          <table className="w-full text-left text-sm">
            <caption className="sr-only">Customers</caption>
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                {["Business", "Owner", "Status", "Signed up", "Tracked", "Last check", "Changes", "Extend trial"].map((h) => (
                  <th key={h} scope="col" className="px-3 py-2 font-medium">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {customers.map((c) => (
                <tr key={c.id} className="align-top">
                  <td className="px-3 py-2">
                    <p className="font-medium">{c.name}</p>
                    <p className="text-xs text-slate-500">
                      {c.website_domain ?? "—"} · {c.category ?? "—"} · {c.service_area ?? "—"}
                    </p>
                  </td>
                  <td className="px-3 py-2 text-xs">
                    {c.owner_email ?? "—"}
                    {c.members > 1 ? <span className="block text-slate-500">+{c.members - 1} more</span> : null}
                  </td>
                  <td className="px-3 py-2 text-xs">{status(c.plan_status, c.trial_ends_at)}</td>
                  <td className="px-3 py-2 text-xs">{day(c.created_at)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.tracked}</td>
                  <td className="px-3 py-2 text-xs">{day(c.last_check)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{c.changes}</td>
                  <td className="px-3 py-2">
                    {c.plan_status === "active" || c.plan_status === "past_due" ? (
                      <span className="text-xs text-slate-500">Paid plan</span>
                    ) : (
                      <ExtendTrialForm orgId={c.id} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-xl bg-white p-5 ring-1 ring-slate-200">
        <h2 className="text-lg font-semibold">Pricing</h2>
        <p className="text-sm text-slate-600">
          Now: {price(p.monthlyCents)}/month · {price(p.annualCents)}/year ({monthsFree(p)} months free) · agencies {price(p.agencyCents)} per location/month, minimum{" "}
          {p.agencyMinLocations}. Changes show on the website right away. Once card billing is live, new prices apply to new subscriptions; existing
          customers keep the price they signed up at.
        </p>
        <PricingForm monthly={dollars(p.monthlyCents)} annual={dollars(p.annualCents)} agency={dollars(p.agencyCents)} agencyMin={p.agencyMinLocations} />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">Admin activity</h2>
        {audit.length === 0 ? (
          <p className="text-sm text-slate-500">No admin actions yet.</p>
        ) : (
          <ul className="flex flex-col gap-2 text-sm">
            {audit.map((a, i) => (
              <li key={i} className="rounded-lg bg-white px-3 py-2 ring-1 ring-slate-200">
                <span className="text-slate-500">{new Date(a.created_at).toLocaleString("en-CA")}</span> · {a.admin_email ?? "?"} ·{" "}
                <strong>{a.action}</strong> · {a.org_name ?? "—"} · &ldquo;{a.reason}&rdquo;
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
