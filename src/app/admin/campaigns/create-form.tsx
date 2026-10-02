"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createCampaignAction, type CampaignState } from "./actions";

export function CreateCampaignForm() {
  const [state, action, pending] = useActionState<CampaignState, FormData>(createCampaignAction, {});
  return (
    <form action={action} className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <div className="flex flex-1 flex-col gap-1.5">
        <Label htmlFor="category">Business type</Label>
        <Input id="category" name="category" required minLength={3} maxLength={60} placeholder="Collision repair" />
      </div>
      <div className="flex flex-1 flex-col gap-1.5">
        <Label htmlFor="city">City</Label>
        <Input id="city" name="city" required minLength={2} maxLength={60} placeholder="Toronto" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="country">Country</Label>
        <select id="country" name="country" defaultValue="CA" className="h-10 rounded-md border border-neutral-300 bg-transparent px-3 text-sm">
          <option value="CA">Canada</option>
          <option value="US">United States</option>
        </select>
      </div>
      <Button type="submit" disabled={pending}>
        {pending ? "Looking up…" : "Create campaign"}
      </Button>
      {state.error ? (
        <p role="alert" className="text-sm text-red-700 sm:basis-full">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
