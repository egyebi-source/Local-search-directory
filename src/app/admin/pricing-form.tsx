"use client";

import { useActionState } from "react";
import { setPricingAction, type AdminState } from "./actions";

const field = "h-9 w-full rounded-md border border-slate-300 bg-transparent px-2 text-sm";

export function PricingForm({ monthly, annual, agency, agencyMin }: { monthly: string; annual: string; agency: string; agencyMin: number }) {
  const [state, action, pending] = useActionState<AdminState, FormData>(setPricingAction, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["monthly", "Monthly (USD)", monthly],
          ["annual", "Annual (USD)", annual],
          ["agency", "Agency, per location / month (USD)", agency],
        ].map(([name, label, value]) => (
          <label key={name} className="flex flex-col gap-1 text-xs text-slate-600">
            {label}
            <input name={name} defaultValue={value} inputMode="decimal" required pattern="\d{1,5}(\.\d{1,2})?" className={field} />
          </label>
        ))}
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Agency minimum locations
          <input name="agencyMin" type="number" min={1} max={100} defaultValue={agencyMin} required className={field} />
        </label>
      </div>
      <label className="flex flex-col gap-1 text-xs text-slate-600">
        Reason for the change (kept in the activity log)
        <input name="reason" required minLength={5} maxLength={300} placeholder="e.g. Launch pricing" className={field} />
      </label>
      <div>
        <button type="submit" disabled={pending} className="rounded-md bg-rose-700 px-4 py-2 text-sm font-medium text-white hover:bg-rose-800 disabled:opacity-50">
          Save prices
        </button>
      </div>
      {state.error ? <p role="alert" className="text-sm text-red-700">{state.error}</p> : null}
      {state.ok ? <p role="status" className="text-sm text-green-700">{state.ok}</p> : null}
    </form>
  );
}
