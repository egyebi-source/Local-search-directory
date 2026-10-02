"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateDetailsAction, type ActionState } from "../actions";

export function DetailsForm({ details }: { details: { name: string; website: string; category: string; serviceArea: string } }) {
  const [state, action, pending] = useActionState<ActionState, FormData>(updateDetailsAction, {});
  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="d-name">Business name</Label>
        <Input id="d-name" name="name" required minLength={2} maxLength={120} defaultValue={details.name} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="d-website">Website (the business&apos;s own site)</Label>
        <Input id="d-website" name="website" required maxLength={253} defaultValue={details.website} placeholder="example.com" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="d-category">Main service</Label>
        <Input id="d-category" name="category" required minLength={2} maxLength={80} defaultValue={details.category} placeholder="e.g. collision repair" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="d-area">City</Label>
        <Input id="d-area" name="serviceArea" required minLength={2} maxLength={120} defaultValue={details.serviceArea} />
      </div>
      <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
        <Button type="submit" disabled={pending}>
          Save details
        </Button>
        {state.error ? (
          <p role="alert" className="text-sm text-red-700">
            {state.error}
          </p>
        ) : state.ok ? (
          <p role="status" className="text-sm text-green-700">
            {state.ok}
          </p>
        ) : null}
      </div>
    </form>
  );
}
