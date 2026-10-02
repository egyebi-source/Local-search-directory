"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { buildPlanAction, type PlanState } from "./actions";

export function BuildPlanButton({ label }: { label: string }) {
  const [state, action, pending] = useActionState<PlanState, FormData>(() => buildPlanAction(), {});
  return (
    <form action={action} className="flex flex-col items-start gap-2">
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? "Researching your searches… (about a minute)" : label}
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
