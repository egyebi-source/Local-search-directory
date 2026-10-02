"use client";

import { useActionState } from "react";
import { extendTrialAction, type AdminState } from "./actions";

export function ExtendTrialForm({ orgId }: { orgId: string }) {
  const [state, action, pending] = useActionState<AdminState, FormData>(extendTrialAction, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-1.5">
      <input type="hidden" name="orgId" value={orgId} />
      <label className="sr-only" htmlFor={`days-${orgId}`}>
        Days
      </label>
      <select id={`days-${orgId}`} name="days" defaultValue="7" className="h-8 rounded border border-slate-300 bg-transparent px-1 text-xs">
        {[3, 7, 14, 30].map((d) => (
          <option key={d} value={d}>
            +{d}d
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor={`reason-${orgId}`}>
        Reason
      </label>
      <input
        id={`reason-${orgId}`}
        name="reason"
        required
        minLength={5}
        maxLength={300}
        placeholder="Reason"
        className="h-8 w-32 rounded border border-slate-300 bg-transparent px-2 text-xs"
      />
      <button type="submit" disabled={pending} className="h-8 rounded bg-rose-700 px-2 text-xs font-medium text-white hover:bg-rose-800 disabled:opacity-50">
        Extend
      </button>
      {state.error ? <span role="alert" className="basis-full text-xs text-red-700">{state.error}</span> : null}
      {state.ok ? <span role="status" className="basis-full text-xs text-green-700">{state.ok}</span> : null}
    </form>
  );
}
