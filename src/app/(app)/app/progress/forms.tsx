"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/lib/i18n/en";
import { addChangeAction, addSearchAction, checkNowAction, type ProgressState } from "./actions";

const p = t.progress;

function Status({ state }: { state: ProgressState }) {
  if (state.error)
    return (
      <p role="alert" className="text-sm text-red-700 dark:text-red-400">
        {state.error}
      </p>
    );
  if (state.ok)
    return (
      <p role="status" className="text-sm text-green-700 dark:text-green-400">
        {state.ok}
      </p>
    );
  return null;
}

export function CheckNowForm() {
  const [state, action, pending] = useActionState<ProgressState, FormData>(() => checkNowAction(), {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <div>
        <Button type="submit" variant="outline" disabled={pending}>
          {p.checkNow}
        </Button>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">{p.checkNote}</p>
      <Status state={state} />
    </form>
  );
}

export function AddSearchForm() {
  const [state, action, pending] = useActionState<ProgressState, FormData>(addSearchAction, {});
  return (
    <form action={action} className="flex flex-col gap-2">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="keyword">{p.addLabel}</Label>
          <Input id="keyword" name="keyword" required minLength={3} maxLength={80} placeholder={p.addPlaceholder} />
        </div>
        <Button type="submit" disabled={pending}>
          {p.addButton}
        </Button>
      </div>
      <Status state={state} />
    </form>
  );
}

export function AddChangeForm({ today }: { today: string }) {
  const [state, action, pending] = useActionState<ProgressState, FormData>(addChangeAction, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="change-title">{p.changeTitle}</Label>
        <Input id="change-title" name="title" required minLength={3} maxLength={120} placeholder={p.changeTitlePlaceholder} />
      </div>
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="flex flex-1 flex-col gap-1.5">
          <Label htmlFor="change-note">{p.changeNote}</Label>
          <Input id="change-note" name="note" maxLength={500} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="change-date">{p.changeDate}</Label>
          <Input id="change-date" name="madeOn" type="date" required defaultValue={today} max={today} />
        </div>
      </div>
      <div>
        <Button type="submit" disabled={pending}>
          {p.changeButton}
        </Button>
      </div>
      <Status state={state} />
    </form>
  );
}
