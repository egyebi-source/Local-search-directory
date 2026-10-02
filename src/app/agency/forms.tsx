"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { addLocationAction, connectLocationAction, createAgencyAction, type AgencyState } from "./actions";

function Message({ state }: { state: AgencyState }) {
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

export function CreateAgencyForm() {
  const [state, action, pending] = useActionState<AgencyState, FormData>(createAgencyAction, {});
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="agency-name">Agency or network name</Label>
        <Input id="agency-name" name="name" required minLength={2} maxLength={80} placeholder="e.g. Northside Marketing" />
      </div>
      <Button type="submit" disabled={pending} className="self-start">
        Create my agency workspace
      </Button>
      <Message state={state} />
    </form>
  );
}

const select = "h-10 rounded-md border border-neutral-300 bg-transparent px-3 text-sm dark:border-neutral-700";

export function AddLocationForm({ agencyId }: { agencyId: string }) {
  const [state, action, pending] = useActionState<AgencyState, FormData>(addLocationAction, {});
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="agencyId" value={agencyId} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="loc-name">Business name</Label>
        <Input id="loc-name" name="name" required minLength={2} maxLength={120} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="loc-website">Website</Label>
        <Input id="loc-website" name="website" required maxLength={253} placeholder="example.com" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="loc-category">Main service</Label>
        <Input id="loc-category" name="category" required minLength={2} maxLength={80} placeholder="e.g. collision repair" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="loc-area">City</Label>
        <Input id="loc-area" name="serviceArea" required minLength={2} maxLength={120} placeholder="e.g. Ottawa, ON" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="loc-country">Country</Label>
        <select id="loc-country" name="country" defaultValue="CA" className={select}>
          <option value="CA">Canada</option>
          <option value="US">United States</option>
        </select>
      </div>
      <div className="flex items-end">
        <Button type="submit" disabled={pending}>
          Add location
        </Button>
      </div>
      <div className="sm:col-span-2">
        <Message state={state} />
      </div>
    </form>
  );
}

export function ConnectForm({ agencyId }: { agencyId: string }) {
  const [state, action, pending] = useActionState<AgencyState, FormData>(connectLocationAction, {});
  return (
    <form action={action} className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
      <input type="hidden" name="agencyId" value={agencyId} />
      <div className="flex min-w-48 flex-1 flex-col gap-1.5">
        <Label htmlFor="connect-code">Code from the business owner</Label>
        <Input id="connect-code" name="code" required maxLength={40} placeholder="XXXX-XXXX-XXXX" autoComplete="off" />
      </div>
      <Button type="submit" disabled={pending}>
        Connect
      </Button>
      {state.error || state.ok ? (
        <div className="sm:basis-full">
          <Message state={state} />
        </div>
      ) : null}
    </form>
  );
}
