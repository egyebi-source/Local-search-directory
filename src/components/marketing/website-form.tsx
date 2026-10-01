"use client";

import { useActionState } from "react";
import { startAssessmentAction, type StartState } from "@/app/start/actions";
import { cn } from "@/lib/utils";

export function WebsiteForm({ id, className }: { id: string; className?: string }) {
  const [state, action, pending] = useActionState<StartState, FormData>(startAssessmentAction, {});
  return (
    <form action={action} className={cn("w-full", className)}>
      <label htmlFor={id} className="sr-only">
        Your business website
      </label>
      <div className="flex flex-col gap-2 rounded-xl bg-white p-2 shadow-lg ring-1 ring-slate-900/10 sm:flex-row dark:bg-slate-900 dark:ring-white/10">
        <input
          id={id}
          name="website"
          inputMode="url"
          autoComplete="url"
          required
          maxLength={253}
          placeholder="yourbusiness.com"
          aria-invalid={state.error ? true : undefined}
          aria-describedby={state.error ? `${id}-error` : undefined}
          className="h-12 min-w-0 flex-1 rounded-lg bg-transparent px-4 text-base text-slate-900 placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-500 dark:text-white dark:placeholder:text-slate-400"
        />
        <button
          type="submit"
          disabled={pending}
          className="h-12 rounded-lg bg-amber-500 px-6 text-base font-semibold text-slate-950 transition-colors hover:bg-amber-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 focus-visible:ring-offset-2 disabled:opacity-60"
        >
          {pending ? "Starting…" : "Get my free assessment"}
        </button>
      </div>
      {state.error ? (
        <p id={`${id}-error`} role="alert" className="mt-2 text-sm font-medium text-red-300">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
