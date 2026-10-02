"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { snapshotNowAction, type SnapshotState } from "./dashboard-actions";

export function SnapshotButton() {
  const [state, action, pending] = useActionState<SnapshotState, FormData>(() => snapshotNowAction(), {});
  return (
    <form action={action} className="flex flex-col items-start gap-2">
      <Button type="submit" disabled={pending}>
        {pending ? "Checking your site… (about 30 seconds)" : "Build my dashboard now"}
      </Button>
      {state.error ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
