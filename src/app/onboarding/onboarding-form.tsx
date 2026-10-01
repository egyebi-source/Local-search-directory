"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/lib/i18n/en";
import { createOrganizationAction, type OnboardingState } from "./actions";

const GOALS = ["calls", "form_leads", "walk_ins", "lower_ad_spend"] as const;
const SPEND = ["none", "under_500", "500_2000", "2000_5000", "over_5000"] as const;
const MANAGERS = ["self", "agency", "nobody"] as const;

function RadioGroup<T extends string>({
  name,
  legend,
  options,
  labels,
}: {
  name: string;
  legend: string;
  options: readonly T[];
  labels: Record<T, string>;
}) {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium">{legend}</legend>
      {options.map((value) => (
        <label key={value} className="flex items-center gap-2 text-sm">
          <input type="radio" name={name} value={value} required className="h-4 w-4" />
          {labels[value]}
        </label>
      ))}
    </fieldset>
  );
}

export function OnboardingForm(props: { defaults?: { website?: string; serviceArea?: string; category?: string } }) {
  const [state, action, pending] = useActionState<OnboardingState, FormData>(createOrganizationAction, {});
  const d = props.defaults ?? {};
  return (
    <form action={action} className="flex flex-col gap-5">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">{t.onboarding.name}</Label>
        <Input id="name" name="name" required minLength={2} maxLength={100} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="website">{t.onboarding.website}</Label>
        <Input id="website" name="website" required inputMode="url" placeholder="example.com" maxLength={253} defaultValue={d.website} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="category">{t.onboarding.category}</Label>
          <Input id="category" name="category" required minLength={2} maxLength={100} placeholder={t.onboarding.categoryHint} defaultValue={d.category} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="serviceArea">{t.onboarding.serviceArea}</Label>
          <Input id="serviceArea" name="serviceArea" required minLength={2} maxLength={100} placeholder={t.onboarding.serviceAreaHint} defaultValue={d.serviceArea} />
        </div>
      </div>
      <RadioGroup name="primaryGoal" legend={t.onboarding.goal.label} options={GOALS} labels={t.onboarding.goal} />
      <RadioGroup name="adSpendRange" legend={t.onboarding.adSpend.label} options={SPEND} labels={t.onboarding.adSpend} />
      <RadioGroup name="websiteManager" legend={t.onboarding.manager.label} options={MANAGERS} labels={t.onboarding.manager} />
      {state.error ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
      <Button type="submit" disabled={pending}>
        {t.onboarding.submit}
      </Button>
    </form>
  );
}
