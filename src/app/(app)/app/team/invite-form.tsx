"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/lib/i18n/en";
import { inviteAction, type ActionState } from "../actions";

export function InviteForm({ allowOwner = true }: { allowOwner?: boolean }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(inviteAction, {});
  return (
    <form action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex flex-1 flex-col gap-1.5">
        <Label htmlFor="invite-email">{t.team.inviteEmail}</Label>
        <Input id="invite-email" name="email" type="email" required maxLength={254} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="invite-role">{t.team.inviteRole}</Label>
        <select
          id="invite-role"
          name="role"
          defaultValue="member"
          className="h-10 rounded-md border border-neutral-300 bg-transparent px-3 text-sm dark:border-neutral-700"
        >
          <option value="member">{t.common.member}</option>
          {allowOwner ? <option value="owner">{t.common.owner}</option> : null}
        </select>
      </div>
      <Button type="submit" disabled={pending}>
        {t.team.inviteSubmit}
      </Button>
      {state.error ? (
        <p role="alert" className="text-sm text-red-700 sm:basis-full dark:text-red-400">
          {state.error}
        </p>
      ) : null}
      {state.ok ? (
        <p role="status" className="text-sm text-green-700 sm:basis-full dark:text-green-400">
          {state.ok}
        </p>
      ) : null}
    </form>
  );
}
