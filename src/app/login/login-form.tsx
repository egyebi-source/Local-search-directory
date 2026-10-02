"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/lib/i18n/en";
import { emailSignInAction, type LoginState } from "./actions";

export function EmailLoginForm({ callbackUrl }: { callbackUrl?: string }) {
  const [state, action, pending] = useActionState<LoginState, FormData>(emailSignInAction, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="callbackUrl" value={callbackUrl ?? ""} />
      <Label htmlFor="email">{t.login.emailLabel}</Label>
      <Input id="email" name="email" type="email" autoComplete="email" required maxLength={254} />
      {state.error ? (
        <p role="alert" className="text-sm text-red-700">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {t.login.emailButton}
      </Button>
    </form>
  );
}
