"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { createConnectCodeAction, type ConnectCodeState } from "../actions";

export function AgencyCodeButton() {
  const [state, action, pending] = useActionState<ConnectCodeState, FormData>(() => createConnectCodeAction(), {});
  return (
    <form action={action} className="flex flex-col gap-3">
      {state.code ? (
        <div className="rounded-lg bg-slate-50 p-4 ring-1 ring-slate-200">
          <p className="text-sm">Give this code to your agency. It works once and expires in 7 days. We won&apos;t show it again.</p>
          <p className="mt-2 font-mono text-2xl font-semibold tracking-wider select-all">{state.code}</p>
        </div>
      ) : (
        <Button type="submit" disabled={pending} className="self-start">
          Create an access code
        </Button>
      )}
      {state.error ? (
        <p role="alert" className="text-sm text-red-700">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
