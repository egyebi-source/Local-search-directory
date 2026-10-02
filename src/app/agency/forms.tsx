"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { BusinessListing } from "@/server/dataforseo/market";
import { addLocationAction, connectLocationAction, createAgencyAction, findListingAction, type AgencyState, type FindState } from "./actions";

function Message({ state }: { state: AgencyState }) {
  if (state.error)
    return (
      <p role="alert" className="text-sm text-red-700">
        {state.error}
      </p>
    );
  if (state.ok)
    return (
      <p role="status" className="text-sm text-green-700">
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

const select = "h-10 rounded-md border border-neutral-300 bg-transparent px-3 text-sm";

/** Google's own category ("Auto body shop") makes a better main service than free text. */
function serviceFromCategory(category: string | null): string {
  if (!category) return "";
  const c = category.toLowerCase();
  if (/auto body|body shop|collision/.test(c)) return "collision repair";
  if (/auto repair|mechanic|car repair|garage/.test(c)) return "auto repair";
  return c.replace(/ (shop|store|service|company)$/, "");
}

export function AddLocationForm({ agencyId }: { agencyId: string }) {
  const [state, action, pending] = useActionState<AgencyState, FormData>(addLocationAction, {});
  const [found, find, finding] = useActionState<FindState, FormData>(findListingAction, {});
  const [picked, setPicked] = useState<BusinessListing | null>(null);
  const [name, setName] = useState("");
  const [area, setArea] = useState("");
  const [country, setCountry] = useState("CA");
  const [website, setWebsite] = useState("");
  const [category, setCategory] = useState("");

  function pick(l: BusinessListing) {
    setPicked(l);
    setName(l.name);
    setWebsite(l.domain ?? "");
    setCategory(serviceFromCategory(l.category));
  }

  return (
    <form action={action} className="grid gap-3 sm:grid-cols-2">
      <input type="hidden" name="agencyId" value={agencyId} />
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="loc-name">Business name</Label>
        <Input id="loc-name" name="name" required minLength={2} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="loc-area">City</Label>
        <Input id="loc-area" name="serviceArea" required minLength={2} maxLength={120} placeholder="e.g. Brampton, ON" value={area} onChange={(e) => setArea(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="loc-country">Country</Label>
        <select id="loc-country" name="country" value={country} onChange={(e) => setCountry(e.target.value)} className={select}>
          <option value="CA">Canada</option>
          <option value="US">United States</option>
        </select>
      </div>
      <div className="flex items-end">
        <Button type="submit" formAction={find} formNoValidate variant="outline" disabled={finding || name.trim().length < 2 || area.trim().length < 2}>
          {finding ? "Searching Google Maps…" : "Find it on Google Maps"}
        </Button>
      </div>

      {found.error ? (
        <p role="alert" className="text-sm text-red-700 sm:col-span-2">
          {found.error}
        </p>
      ) : null}
      {found.listings ? (
        <fieldset className="flex flex-col gap-2 sm:col-span-2">
          <legend className="mb-1 text-sm font-medium">
            {found.listings.length ? "Which one is it?" : "Nothing found on Google Maps. Check the name and city, or enter the details yourself below."}
          </legend>
          {found.listings.map((l) => (
            <label
              key={`${l.name}|${l.address}`}
              className={`flex cursor-pointer items-start gap-3 rounded-lg p-3 ring-1 ${picked === l ? "bg-rose-50 ring-rose-400" : "ring-slate-200 hover:bg-slate-50"}`}
            >
              <input type="radio" name="listing" className="mt-1" checked={picked === l} onChange={() => pick(l)} />
              <span className="text-sm">
                <span className="font-medium">{l.name}</span>
                {l.rating !== null ? (
                  <span className="text-slate-600">
                    {" "}
                    · {l.rating}★{l.reviews !== null ? ` (${l.reviews.toLocaleString("en-US")} reviews)` : ""}
                  </span>
                ) : null}
                <span className="block text-slate-600">{[l.category, l.address].filter(Boolean).join(" · ")}</span>
                <span className="block text-slate-500">{l.domain ? `Website: ${l.domain}` : "No website on its Google listing"}</span>
              </span>
            </label>
          ))}
        </fieldset>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="loc-website">Website</Label>
        <Input id="loc-website" name="website" required maxLength={253} placeholder="example.com" value={website} onChange={(e) => setWebsite(e.target.value)} />
        {picked && !picked.domain ? <p className="text-xs text-slate-600">This listing has no website. Enter the shop&apos;s own site (not a directory page).</p> : null}
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="loc-category">Main service</Label>
        <Input id="loc-category" name="category" required minLength={2} maxLength={80} placeholder="e.g. collision repair" value={category} onChange={(e) => setCategory(e.target.value)} />
      </div>
      <div className="flex items-end sm:col-span-2">
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
