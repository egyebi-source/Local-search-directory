import Link from "next/link";
import { listActions, type ActionItem } from "@/server/actions/plan";
import type { ActionKind } from "@/server/db/schema";
import { withCurrentOrg } from "@/server/org/current";
import { dismissActionAction, markDoneAction } from "./actions";
import { CopyButton, RefreshPlanForm } from "./client";

const KIND: Record<ActionKind, { label: string; time: string }> = {
  review_request: { label: "Reviews", time: "10 min to set up" },
  review_reply: { label: "Reviews", time: "15 min" },
  gbp_profile: { label: "Google Business Profile", time: "30 min" },
  gbp_post: { label: "Google Business Profile", time: "5 min a week" },
  page_title: { label: "Website", time: "10 min" },
  new_page: { label: "Website", time: "2–3 hours" },
};

function Card({ item }: { item: ActionItem }) {
  const k = KIND[item.kind];
  return (
    <li className="flex flex-col gap-3 rounded-xl bg-white p-5 ring-1 ring-slate-200">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="rounded-full bg-slate-100 px-2 py-0.5 font-medium text-slate-700">{k.label}</span>
        <span className="text-slate-500">{k.time}</span>
        {item.valueUsdMonth ? (
          <span className="rounded-full bg-green-100 px-2 py-0.5 font-medium text-green-800">
            Worth about ${item.valueUsdMonth.toLocaleString("en-US")}/month in ad clicks (estimate)
          </span>
        ) : null}
      </div>
      <h2 className="text-lg font-semibold">{item.title}</h2>
      <p className="text-sm text-slate-700">{item.why}</p>
      {/* Plain text only: AI output is never rendered as HTML. */}
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg bg-slate-50 p-3 font-sans text-sm text-slate-800 ring-1 ring-slate-200">
        {item.content}
      </pre>
      <div className="flex flex-wrap items-center gap-2">
        <CopyButton text={item.content} />
        <form action={markDoneAction}>
          <input type="hidden" name="id" value={item.id} />
          <button type="submit" className="rounded-md bg-rose-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-rose-800">
            I did this
          </button>
        </form>
        <form action={dismissActionAction}>
          <input type="hidden" name="id" value={item.id} />
          <button type="submit" className="px-2 py-1.5 text-sm text-slate-500 underline hover:text-slate-800">
            Not for us
          </button>
        </form>
      </div>
    </li>
  );
}

export default async function ActionPlanPage() {
  const { open, done } = await withCurrentOrg((tx, ctx) => listActions(tx, ctx.orgId));
  const fromAi = open.some((i) => i.source === "ai");
  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold">Action plan</h1>
        <p className="max-w-2xl text-slate-600">
          Ready-to-use changes, most valuable first. Copy, make the change, then tap <strong>I did this</strong>. We&apos;ll log it on your{" "}
          <Link href="/app/progress" className="underline">
            Progress
          </Link>{" "}
          page and show what moved afterwards.
        </p>
        {open.length ? (
          <p className="text-xs text-slate-500">
            {fromAi ? "Written by AI from your numbers: check details before publishing." : "Built from your numbers."} Fill in anything in
            [square brackets].
          </p>
        ) : null}
      </div>

      {open.length ? (
        <ol className="flex flex-col gap-4">
          {open.map((i) => (
            <Card key={i.id} item={i} />
          ))}
        </ol>
      ) : (
        <p className="text-slate-600">{done.length ? "You've worked through your plan. Nice work." : "No plan yet."}</p>
      )}

      <RefreshPlanForm label={open.length ? "Get fresh suggestions" : "Build my plan"} />

      {done.length ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-xl font-semibold">Done</h2>
          <ul className="flex flex-col gap-2">
            {done.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-white px-4 py-3 text-sm ring-1 ring-slate-200">
                <span>✓ {i.title}</span>
                <span className="text-xs text-slate-500">{i.doneAt?.toLocaleDateString("en-CA")}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
