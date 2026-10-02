import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { agencyRollup, listMyAgencies, type LocationRow, type MyAgency } from "@/server/agency/agency";
import { hasAccess } from "@/server/billing/access";
import { getPricing, usd } from "@/server/billing/pricing";
import { requireUser } from "@/server/org/current";
import { endLocationAction, openLocationAction } from "./actions";
import { AddLocationForm, ConnectForm, CreateAgencyForm } from "./forms";

export const dynamic = "force-dynamic";

function statusLine(a: MyAgency): string {
  switch (a.access.kind) {
    case "trialing":
      return `Free trial · ${a.access.daysLeft} day${a.access.daysLeft === 1 ? "" : "s"} left · up to 10 locations`;
    case "active":
      return "Active plan";
    case "past_due":
      return "Payment problem: update your card to keep access";
    default:
      return "Trial ended";
  }
}

function Delta({ v, suffix = "", invert = false }: { v: number | null; suffix?: string; invert?: boolean }) {
  if (v === null || v === 0) return null;
  const good = invert ? v < 0 : v > 0;
  return (
    <span className={good ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}>
      {" "}
      {v > 0 ? "▲" : "▼"} {Math.abs(v)}
      {suffix}
    </span>
  );
}

function Position({ trend }: { trend: LocationRow["organicTrend"] }) {
  if (!trend || (trend.from === null && trend.to === null)) return <span className="opacity-60">not ranked yet</span>;
  const f = trend.from === null ? "—" : `#${trend.from}`;
  const t = trend.to === null ? "—" : `#${trend.to}`;
  if (f === t) return <span>{t}</span>;
  return (
    <span>
      {f} → <strong>{t}</strong>
    </span>
  );
}

function Summary({ rows }: { rows: LocationRow[] }) {
  const vis = rows.flatMap((r) => (r.visibility === null ? [] : [r.visibility]));
  const avg = vis.length ? Math.round((vis.reduce((a, b) => a + b, 0) / vis.length) * 10) / 10 : null;
  const improving = rows.filter((r) => (r.weekChange ?? 0) > 0).length;
  const slipping = rows.filter((r) => (r.weekChange ?? 0) < 0).length;
  const topicsToFix = rows.reduce((n, r) => n + (r.topics ? r.topics.total - r.topics.aligned : 0), 0);
  const tiles = [
    { label: "Locations", value: String(rows.length) },
    { label: "Average visibility", value: avg === null ? "—" : `${avg}%` },
    {
      label: "Moving up / down on Google this week",
      value: `${improving} / ${slipping}`,
    },
    { label: "Keyword topics to fix", value: String(topicsToFix) },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className="rounded-xl bg-white p-4 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
          <p className="text-xs text-slate-600 dark:text-slate-400">{t.label}</p>
          <p className="mt-1 text-2xl font-semibold">{t.value}</p>
        </div>
      ))}
    </div>
  );
}

function RowActions({ agency, r }: { agency: MyAgency; r: LocationRow }) {
  return (
    <div className="flex flex-col items-end gap-1">
      <form action={openLocationAction}>
        <input type="hidden" name="orgId" value={r.orgId} />
        <Button type="submit" size="sm" disabled={!hasAccess(agency.access)}>
          Open
        </Button>
      </form>
      {agency.role === "owner" ? (
        <details className="text-right text-xs">
          <summary className="cursor-pointer opacity-70">More</summary>
          <form action={endLocationAction} className="mt-2 flex max-w-56 flex-col items-end gap-2">
            <input type="hidden" name="agencyId" value={agency.id} />
            <input type="hidden" name="orgId" value={r.orgId} />
            <p className="text-left opacity-80">
              {r.hasOwner
                ? "Stop managing this location. The owner keeps their account and data."
                : "Stop managing this location. Nobody else has a login, so it will be locked and deleted after 30 days."}
            </p>
            <Button type="submit" size="sm" variant="destructive">
              Stop managing
            </Button>
          </form>
        </details>
      ) : null}
    </div>
  );
}

function WeekChange({ v }: { v: number | null }) {
  if (!v) return null;
  return (
    <div className="text-xs">
      <span className={v > 0 ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400"}>
        {v > 0 ? "▲" : "▼"} {Math.abs(v)} this week
      </span>
    </div>
  );
}

/** Phones: one card per location instead of a wide table. */
function LocationCards({ agency, rows }: { agency: MyAgency; rows: LocationRow[] }) {
  return (
    <ul className="flex flex-col divide-y divide-slate-200 md:hidden dark:divide-slate-800">
      {rows.map((r) => (
        <li key={r.orgId} className="flex flex-col gap-2 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-medium">{r.name}</div>
              <div className="break-words text-xs text-slate-600 dark:text-slate-400">
                {[r.domain, r.serviceArea].filter(Boolean).join(" · ")}
              </div>
            </div>
            <RowActions agency={agency} r={r} />
          </div>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
            <dt className="text-slate-600 dark:text-slate-400">Visibility</dt>
            <dd>
              {r.visibility === null ? "—" : `${r.visibility}%`}
              <Delta v={r.visibilityChange} />
            </dd>
            <dt className="text-slate-600 dark:text-slate-400">{r.mainSearch ? `“${r.mainSearch}”` : "Main search"}</dt>
            <dd>
              <Position trend={r.organicTrend} />
              <WeekChange v={r.weekChange} />
            </dd>
            <dt className="text-slate-600 dark:text-slate-400">Google Maps</dt>
            <dd>{r.mapRank === null ? "—" : `#${r.mapRank}`}</dd>
            <dt className="text-slate-600 dark:text-slate-400">Topics aligned</dt>
            <dd>{r.topics ? `${r.topics.aligned} of ${r.topics.total}` : "no plan yet"}</dd>
            <dt className="text-slate-600 dark:text-slate-400">To do</dt>
            <dd>{r.openActions}</dd>
          </dl>
          {!r.hasOwner ? (
            <p className="text-xs text-amber-800 dark:text-amber-300">No owner login yet: invite them from its Team page</p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

function LocationsTable({ agency, rows }: { agency: MyAgency; rows: LocationRow[] }) {
  if (!rows.length)
    return <p className="text-sm opacity-70">No locations yet. Add one below, or connect one with the owner&apos;s code.</p>;
  return (
    <>
      <LocationCards agency={agency} rows={rows} />
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="text-xs text-slate-600 dark:text-slate-400">
            <tr className="border-b border-slate-200 dark:border-slate-800">
              <th className="py-2 pr-3 font-medium">Location</th>
              <th className="py-2 pr-3 font-medium">Visibility</th>
              <th className="py-2 pr-3 font-medium">Main search on Google</th>
              <th className="py-2 pr-3 font-medium">Maps</th>
              <th className="py-2 pr-3 font-medium">Topics aligned</th>
              <th className="py-2 pr-3 font-medium">To do</th>
              <th className="py-2 font-medium">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.orgId} className="border-b border-slate-100 align-top dark:border-slate-800">
                <td className="py-3 pr-3">
                  <div className="font-medium">{r.name}</div>
                  <div className="text-xs text-slate-600 dark:text-slate-400">{[r.domain, r.serviceArea].filter(Boolean).join(" · ")}</div>
                  {!r.hasOwner ? (
                    <div className="mt-1 text-xs text-amber-800 dark:text-amber-300">
                      No owner login yet: invite them from its Team page
                    </div>
                  ) : null}
                </td>
                <td className="py-3 pr-3 whitespace-nowrap">
                  {r.visibility === null ? <span className="opacity-60">—</span> : `${r.visibility}%`}
                  <Delta v={r.visibilityChange} />
                </td>
                <td className="py-3 pr-3">
                  {r.mainSearch ? <div className="text-xs text-slate-600 dark:text-slate-400">&ldquo;{r.mainSearch}&rdquo;</div> : null}
                  <Position trend={r.organicTrend} />
                  <WeekChange v={r.weekChange} />
                </td>
                <td className="py-3 pr-3 whitespace-nowrap">
                  {r.mapRank === null ? <span className="opacity-60">—</span> : `#${r.mapRank}`}
                </td>
                <td className="py-3 pr-3 whitespace-nowrap">
                  {r.topics ? `${r.topics.aligned} of ${r.topics.total}` : <span className="opacity-60">no plan yet</span>}
                </td>
                <td className="py-3 pr-3 whitespace-nowrap">{r.openActions}</td>
                <td className="py-3">
                  <RowActions agency={agency} r={r} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default async function AgencyPage({ searchParams }: PageProps<"/agency">) {
  const user = await requireUser();
  const agencies = await listMyAgencies(user.id);
  const pricing = await getPricing();
  const price = `${usd(pricing.agencyCents)} per location per month (minimum ${pricing.agencyMinLocations} locations)`;

  if (!agencies.length) {
    return (
      <div className="flex max-w-2xl flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold">Manage many businesses with one login</h1>
          <p className="mt-2 text-slate-700 dark:text-slate-300">
            For marketing agencies, freelancers and networks of independent shops. See every location&apos;s rankings, keyword plan and
            to-do list in one place, and open any of them in one click.
          </p>
        </div>
        <Card className="flex flex-col gap-3">
          <CardTitle>Start your agency workspace</CardTitle>
          <ul className="list-disc pl-5 text-sm text-slate-700 dark:text-slate-300">
            <li>Free for 14 days, for up to 10 locations. No card needed.</li>
            <li>Then {price}. Mark it up for your clients however you like.</li>
            <li>Each business keeps its own account and data, and can remove your access at any time.</li>
          </ul>
          <CreateAgencyForm />
        </Card>
      </div>
    );
  }

  const { a } = await searchParams;
  const agency = agencies.find((x) => x.id === a) ?? agencies[0];
  const rows = await agencyRollup(user.id, agency.id);

  return (
    <div className="flex flex-col gap-6">
      {agencies.length > 1 ? (
        <nav className="flex flex-wrap gap-2 text-sm">
          {agencies.map((x) => (
            <Link
              key={x.id}
              href={`/agency?a=${x.id}`}
              className={`rounded-full px-3 py-1 ring-1 ring-slate-300 dark:ring-slate-700 ${x.id === agency.id ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900" : ""}`}
            >
              {x.name}
            </Link>
          ))}
        </nav>
      ) : null}

      <div>
        <h1 className="text-2xl font-semibold">{agency.name}</h1>
        <p className="text-sm text-slate-600 dark:text-slate-400">{statusLine(agency)}</p>
      </div>

      {!hasAccess(agency.access) ? (
        <p
          role="alert"
          className="rounded-lg bg-amber-50 p-3 text-sm text-amber-950 ring-1 ring-amber-300 dark:bg-amber-950 dark:text-amber-100 dark:ring-amber-800"
        >
          Your free trial has ended, so you can&apos;t open locations until you choose a plan ({price}). Online checkout for agencies is
          being added.
        </p>
      ) : null}

      <Summary rows={rows} />

      <Card className="flex flex-col gap-3">
        <CardTitle>Your locations</CardTitle>
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Visibility is the share of possible clicks each business gets for the searches we track. The main search shows its Google position
          when you started → now. Click Open to see the full dashboard, keyword plan and to-do list.
        </p>
        <LocationsTable agency={agency} rows={rows} />
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="flex flex-col gap-3">
          <CardTitle>Add a new client</CardTitle>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            For a business that isn&apos;t on TorqueRank yet. You set it up; invite the owner later from its Team page.{" "}
            <Link href="/help#add-client" className="underline">
              Guide
            </Link>
          </p>
          <AddLocationForm agencyId={agency.id} />
        </Card>
        <Card className="flex flex-col gap-3">
          <CardTitle>Connect a business that already uses TorqueRank</CardTitle>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            The owner signs in, goes to <strong>Team → Give an agency access</strong>, and sends you the code. We never connect a business
            without its owner&apos;s say-so.{" "}
            <Link href="/help#connect-client" className="underline">
              Guide
            </Link>
          </p>
          <ConnectForm agencyId={agency.id} />
        </Card>
      </div>

      <p className="text-xs text-slate-600 dark:text-slate-400">Price after the trial: {price}.</p>
    </div>
  );
}
