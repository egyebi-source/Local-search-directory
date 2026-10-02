import Link from "next/link";
import { Button } from "@/components/ui/button";
import { withOrg } from "@/server/db/tenant";
import { GoogleApiError, GoogleReauthError, googleConfig, httpGoogle } from "@/server/google/client";
import { listChoices, loadConnection, markNeedsReauth } from "@/server/google/connection";
import { withCurrentOrg } from "@/server/org/current";
import { connectGoogleAction, disconnectGoogleAction, savePropertiesAction } from "./actions";

export const dynamic = "force-dynamic";

const RESULTS: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: "Connected. Now choose your website and GA4 property below." },
  saved: { ok: true, text: "Saved. We're fetching your numbers now (up to 16 months of Search Console history). Refresh your dashboard in a minute." },
  disconnected: { ok: true, text: "Disconnected. We told Google to cancel our access and deleted the stored key." },
  denied: { ok: false, text: "Nothing was connected: you chose not to allow access on Google's screen." },
  noscopes: { ok: false, text: "Nothing was connected: on Google's screen, tick at least one of Search Console or Analytics." },
  expired: { ok: false, text: "That connection attempt expired or came from another browser. Please try again." },
  owners: { ok: false, text: "Only an owner of this business can connect or change its Google accounts." },
  pick: { ok: false, text: "We couldn't save that choice. Please pick again." },
  off: { ok: false, text: "Google connection isn't switched on for this site yet." },
  failed: { ok: false, text: "Google didn't complete the connection. Please try again in a minute." },
};

const fmt = (d: Date) => d.toLocaleString("en-CA", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const select = "h-10 w-full rounded-md border border-neutral-300 bg-transparent px-3 text-sm";

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3 rounded-xl bg-white p-5 ring-1 ring-slate-200">
      <h2 className="font-semibold">{title}</h2>
      {children}
    </section>
  );
}

export default async function GooglePage({ searchParams }: PageProps<"/app/google">) {
  const { r, change } = await searchParams;
  const result = typeof r === "string" ? RESULTS[r] : undefined;
  const cfg = googleConfig();

  const { conn, choices, role } = await withCurrentOrg(async (tx, ctx) => {
    const conn = await loadConnection(tx, ctx.orgId);
    const wantPicker = conn?.status === "active" && ctx.role === "owner" && (change === "1" || (!conn.gsc && !conn.ga4));
    let choices: Awaited<ReturnType<typeof listChoices>> | "reauth" | "unavailable" = null;
    if (wantPicker && cfg) {
      try {
        choices = await listChoices(tx, ctx.orgId, httpGoogle, cfg);
      } catch (err) {
        if (err instanceof GoogleReauthError) choices = "reauth";
        else if (err instanceof GoogleApiError) choices = "unavailable";
        else throw err;
      }
    }
    return { conn, choices, role: ctx.role, ctx };
  }).then(async (v) => {
    // Google refused the stored token while listing: record it (in its own transaction) and show Reconnect.
    if (v.choices === "reauth") {
      await withOrg(v.ctx.userId, v.ctx.orgId, (tx) => markNeedsReauth(tx, v.ctx.orgId));
      return { ...v, conn: v.conn ? { ...v.conn, status: "needs_reauth" as const } : null, choices: null };
    }
    return v;
  });
  const isOwner = role === "owner";

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Google data</h1>
        <p className="mt-1 text-slate-700">
          Connect your own Google Search Console and Google Analytics (GA4) to see the real clicks Google sends you, the exact words people
          searched, and how many of them called or filled in a form.{" "}
          <Link href="/help#before-you-start" className="underline">
            Step-by-step guide
          </Link>
        </p>
      </div>

      {result ? (
        <p
          role={result.ok ? "status" : "alert"}
          className={`rounded-lg px-4 py-3 text-sm ${result.ok ? "bg-green-50 text-green-900" : "bg-red-50 text-red-900"}`}
        >
          {result.text}
        </p>
      ) : null}

      {!conn && !cfg ? (
        <Card title="Coming soon on this site">
          <p className="text-sm text-slate-700">
            Google connection isn&apos;t switched on here yet. Your dashboard keeps working with our own rank checks in the meantime.
          </p>
        </Card>
      ) : !conn ? (
        <Card title="Connect your Google accounts">
          <ul className="list-disc pl-5 text-sm text-slate-700">
            <li>You sign in on Google&apos;s own screen. We never see or store your Google password.</li>
            <li>
              <strong>Read-only:</strong> we can view Search Console and Analytics reports. We can&apos;t change your website, ads, settings or
              anything else.
            </li>
            <li>Your data is only used for your own dashboard and recommendations. It&apos;s never sold, shared or used to train AI.</li>
            <li>Disconnect any time, here or in your Google account.</li>
          </ul>
          {isOwner ? (
            <form action={connectGoogleAction}>
              <Button type="submit">Connect Google</Button>
            </form>
          ) : (
            <p className="text-sm opacity-80">Ask an owner of this business to connect Google.</p>
          )}
        </Card>
      ) : conn.status !== "active" ? (
        <Card title="Reconnect needed">
          <p className="text-sm text-slate-700">
            Google stopped sharing data with us (access was removed, the password changed, or the connection expired). Your dashboard keeps the
            numbers it already has; reconnect to start updating again.
          </p>
          {isOwner ? (
            <form action={connectGoogleAction}>
              <Button type="submit">Reconnect Google</Button>
            </form>
          ) : (
            <p className="text-sm opacity-80">Ask an owner of this business to reconnect.</p>
          )}
        </Card>
      ) : (
        <>
          <Card title="Connected">
            <dl className="grid gap-2 text-sm sm:grid-cols-[10rem_1fr]">
              <dt className="text-slate-600">Search Console</dt>
              <dd className="break-all">{conn.gsc ? conn.gsc.displayName : conn.scopes.searchConsole ? "Not chosen yet" : "Not allowed on Google's screen"}</dd>
              <dt className="text-slate-600">Google Analytics</dt>
              <dd className="break-words">{conn.ga4 ? conn.ga4.displayName : conn.scopes.analytics ? "Not chosen yet" : "Not allowed on Google's screen"}</dd>
              <dt className="text-slate-600">Last updated</dt>
              <dd>
                {conn.lastSyncedAt ? fmt(conn.lastSyncedAt) : "Waiting for the first update (tonight)"}
                {conn.lastError && conn.lastError !== "invalid_grant" ? " · Google was busy last time; we'll retry tomorrow" : ""}
              </dd>
            </dl>
            {isOwner && cfg && (conn.gsc || conn.ga4) && change !== "1" ? (
              <Link href="/app/google?change=1" className="text-sm underline">
                Change website or property
              </Link>
            ) : null}
          </Card>

          {choices === "unavailable" ? (
            <p role="alert" className="text-sm text-red-700">
              Google didn&apos;t answer just now. Please refresh in a minute.
            </p>
          ) : choices && typeof choices === "object" ? (
            <Card title="Choose what to use">
              <form action={savePropertiesAction} className="flex flex-col gap-4">
                {choices.scopes.searchConsole ? (
                  <label className="flex flex-col gap-1.5 text-sm">
                    <span className="font-medium">Search Console website</span>
                    {choices.sites?.length ? (
                      <select name="gsc" defaultValue={conn.gsc?.externalId ?? choices.sites[0].siteUrl} className={select}>
                        {choices.sites.map((s) => (
                          <option key={s.siteUrl} value={s.siteUrl}>
                            {s.siteUrl.replace(/^sc-domain:/, "")}
                          </option>
                        ))}
                        <option value="">Don&apos;t use Search Console</option>
                      </select>
                    ) : (
                      <span className="text-slate-600">
                        This Google account has no verified websites in Search Console. Add your site at search.google.com/search-console, then
                        come back.
                      </span>
                    )}
                  </label>
                ) : null}
                {choices.scopes.analytics ? (
                  <label className="flex flex-col gap-1.5 text-sm">
                    <span className="font-medium">Google Analytics (GA4) property</span>
                    {choices.properties?.length ? (
                      <select name="ga4" defaultValue={conn.ga4?.externalId ?? choices.properties[0].property} className={select}>
                        {choices.properties.map((p) => (
                          <option key={p.property} value={p.property}>
                            {p.displayName}
                            {p.account ? ` (${p.account})` : ""}
                          </option>
                        ))}
                        <option value="">Don&apos;t use Analytics</option>
                      </select>
                    ) : (
                      <span className="text-slate-600">This Google account has no GA4 properties.</span>
                    )}
                  </label>
                ) : null}
                <Button type="submit" className="self-start">
                  Save
                </Button>
              </form>
            </Card>
          ) : null}

          {isOwner ? (
            <Card title="Disconnect">
              <details className="text-sm">
                <summary className="cursor-pointer font-medium">Disconnect Google</summary>
                <form action={disconnectGoogleAction} className="mt-3 flex flex-col gap-3">
                  <p className="opacity-80">We&apos;ll ask Google to cancel our access and delete the stored key right away.</p>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="deleteData" />
                    Also delete the Search Console and Analytics numbers we&apos;ve saved
                  </label>
                  <Button type="submit" variant="destructive" size="sm" className="self-start">
                    Disconnect
                  </Button>
                </form>
              </details>
            </Card>
          ) : null}
        </>
      )}
    </div>
  );
}
