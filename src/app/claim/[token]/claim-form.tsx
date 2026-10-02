"use client";

import { useActionState } from "react";
import { startClaimAction, type ClaimState } from "./actions";

export function ClaimForm({ token, domain }: { token: string; domain: string }) {
  const [state, action, pending] = useActionState<ClaimState, FormData>(startClaimAction, {});
  return (
    <form action={action} className="flex w-full max-w-md flex-col gap-2">
      <input type="hidden" name="token" value={token} />
      <label htmlFor="email" className="text-sm text-slate-700">
        Your work email (must end in @{domain})
      </label>
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          id="email"
          name="email"
          type="email"
          required
          maxLength={254}
          autoComplete="email"
          placeholder={`you@${domain}`}
          className="h-11 flex-1 rounded-lg border border-rose-200 bg-white px-3 text-slate-900 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300"
        />
        <button
          type="submit"
          disabled={pending}
          className="h-11 rounded-lg bg-rose-700 px-5 font-semibold text-white hover:bg-rose-800 disabled:opacity-60"
        >
          Claim my free report
        </button>
      </div>
      {state.error ? (
        <p role="alert" className="text-sm text-red-700">
          {state.error}
        </p>
      ) : null}
      <p className="text-xs text-slate-400">We&apos;ll email you a secure sign-in link. 7-day free trial, no credit card.</p>
    </form>
  );
}
