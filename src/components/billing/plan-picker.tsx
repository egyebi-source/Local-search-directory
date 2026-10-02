"use client";

import { useActionState } from "react";
import { checkoutAction, portalAction, type BillingState } from "@/app/billing-actions";

type Props = { monthly: string; annual: string; annualNote: string; dark?: boolean };

export function PlanPicker({ monthly, annual, annualNote, dark = false }: Props) {
  const [state, action, pending] = useActionState<BillingState, FormData>(checkoutAction, {});
  const card = dark ? "bg-slate-900 ring-slate-700" : "bg-white ring-slate-200 dark:bg-slate-900 dark:ring-slate-800";
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {[
          { plan: "monthly", name: "Monthly", price: monthly, period: "USD / month", note: "Cancel anytime" },
          { plan: "annual", name: "Annual", price: annual, period: "USD / year", note: annualNote },
        ].map((p) => (
          <form key={p.plan} action={action} className={`flex flex-col gap-2 rounded-xl p-5 ring-1 ${card}`}>
            <input type="hidden" name="plan" value={p.plan} />
            <p className="text-sm font-medium">{p.name}</p>
            <p className="text-3xl font-bold">
              {p.price} <span className="text-sm font-normal opacity-70">{p.period}</span>
            </p>
            <p className="text-xs opacity-70">{p.note}</p>
            <button
              type="submit"
              disabled={pending}
              className="mt-2 rounded-lg bg-amber-500 px-4 py-2 font-semibold text-slate-950 hover:bg-amber-400 disabled:opacity-60"
            >
              {pending ? "Opening secure payment…" : `Choose ${p.name.toLowerCase()}`}
            </button>
          </form>
        ))}
      </div>
      {state.error ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
      <p className="text-xs opacity-70">
        Secure payment by Stripe; we never see your card number. Billed in US dollars; your bank converts. Applicable taxes extra.
      </p>
    </div>
  );
}

export function ManageBillingButton() {
  const [state, action, pending] = useActionState<BillingState, FormData>(() => portalAction(), {});
  return (
    <form action={action} className="flex flex-col items-start gap-2">
      <button type="submit" disabled={pending} className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 dark:bg-white dark:text-slate-900">
        {pending ? "Opening…" : "Change card, switch plan or cancel"}
      </button>
      {state.error ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
