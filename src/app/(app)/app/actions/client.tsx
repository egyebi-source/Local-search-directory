"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { refreshPlanAction, type PlanState } from "./actions";

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        } catch {
          setCopied(false);
        }
      }}
      className="rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium hover:bg-slate-100 dark:border-slate-700 dark:hover:bg-slate-800"
    >
      {copied ? "Copied ✓" : "Copy"}
    </button>
  );
}

export function RefreshPlanForm({ label }: { label: string }) {
  const [state, action, pending] = useActionState<PlanState, FormData>(() => refreshPlanAction(), {});
  return (
    <form action={action} className="flex flex-col items-start gap-2">
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Writing your plan…" : label}
      </Button>
      {state.error ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p role="status" className="text-sm text-green-700 dark:text-green-400">
          {state.ok}
        </p>
      ) : null}
    </form>
  );
}
