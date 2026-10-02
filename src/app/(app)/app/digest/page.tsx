import Link from "next/link";
import { buildDigest } from "@/server/digest/digest";
import { withCurrentOrg } from "@/server/org/current";

// What this week's email says, inside the app (also how the demo shows it).
export default async function DigestPreviewPage() {
  const d = await withCurrentOrg((tx, ctx) => buildDigest(tx, ctx.orgId));
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">This week&apos;s email</h1>
        <p className="mt-1 text-slate-600">
          Every Monday morning, owners get this summary by email. Here&apos;s what it says right now.
        </p>
      </div>
      {!d ? (
        <p className="text-slate-600">Your first weekly email goes out after two days of checks.</p>
      ) : (
        <article className="max-w-xl rounded-xl bg-white p-6 ring-1 ring-slate-200">
          <p className="text-xs text-slate-500">Subject: {d.subject}</p>
          <h2 className="mt-3 text-xl font-semibold">Your week on Google: {d.businessName}</h2>
          <dl className="mt-4 flex flex-col gap-2 text-sm">
            {d.lines.map((l) => (
              <div key={l.label} className="grid gap-1 sm:grid-cols-[40%_1fr]">
                <dt className="text-slate-600">{l.label}</dt>
                <dd className={l.good === null ? "" : l.good ? "text-green-700" : "text-red-700"}>{l.text}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-4 text-sm">
            <p className="font-semibold">Changes you logged this week</p>
            {d.changes.length ? (
              <ul className="mt-1 list-disc pl-5">
                {d.changes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            ) : (
              <p className="text-slate-600">None this week.</p>
            )}
          </div>
          {d.next ? (
            <p className="mt-4 text-sm">
              <strong>Your next step:</strong> {d.next.title}
              <br />
              <span className="text-slate-600">{d.next.why}</span>
            </p>
          ) : null}
          <p className="mt-5">
            <Link href="/app/progress" className="inline-block rounded-lg bg-rose-700 px-4 py-2 text-sm font-semibold text-white hover:bg-rose-800">
              See your progress
            </Link>
          </p>
          <p className="mt-4 text-xs text-slate-500">Every email has a one-click link to stop them.</p>
        </article>
      )}
    </div>
  );
}
