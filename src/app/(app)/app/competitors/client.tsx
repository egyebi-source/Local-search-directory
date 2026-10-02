"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addCompetitorAction, runCheckAction, type CompetitorState } from "./actions";

function Message({ state }: { state: CompetitorState }) {
  if (state.error) return <p role="alert" className="text-sm text-red-700">{state.error}</p>;
  if (state.ok) return <p role="status" className="text-sm text-green-700">{state.ok}</p>;
  return null;
}

export function AddCompetitorForm() {
  const [state, action, pending] = useActionState<CompetitorState, FormData>(addCompetitorAction, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input name="domain" aria-label="Competitor website" placeholder="rivalshop.com" required maxLength={253} className="sm:max-w-sm" />
        <Button type="submit" variant="outline" disabled={pending}>
          Add competitor
        </Button>
      </div>
      <Message state={state} />
    </form>
  );
}

export function AddSuggestedButton({ domain }: { domain: string }) {
  const [state, action, pending] = useActionState<CompetitorState, FormData>(addCompetitorAction, {});
  return (
    <form action={action} className="inline">
      <input type="hidden" name="domain" value={domain} />
      <input type="hidden" name="source" value="suggested" />
      <Button type="submit" size="sm" variant="outline" disabled={pending || Boolean(state.ok)}>
        {state.ok ? "Added" : "Track"}
      </Button>
      {state.error ? <span className="ml-2 text-xs text-red-700">{state.error}</span> : null}
    </form>
  );
}

export function RunCheckButton({ hasReport }: { hasReport: boolean }) {
  const [state, action, pending] = useActionState<CompetitorState, FormData>(() => runCheckAction(), {});
  return (
    <form action={action} className="flex flex-col items-start gap-2">
      <Button type="submit" disabled={pending}>
        {pending ? "Checking Google (about 20 seconds)…" : hasReport ? "Run a fresh check" : "Run competitor check"}
      </Button>
      <Message state={state} />
    </form>
  );
}
