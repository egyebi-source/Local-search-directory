"use client";

import { useActionState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/lib/i18n/en";
import { createOrganizationAction, type OnboardingState } from "./actions";

export function OnboardingForm() {
  const [state, action, pending] = useActionState<OnboardingState, FormData>(
    createOrganizationAction,
    {},
  );
  return (
    <form action={action} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="name">{t.onboarding.name}</Label>
        <Input id="name" name="name" required minLength={2} maxLength={100} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="website">{t.onboarding.website}</Label>
        <Input id="website" name="website" inputMode="url" placeholder="example.com" maxLength={253} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="serviceArea">{t.onboarding.serviceArea}</Label>
        <Input id="serviceArea" name="serviceArea" placeholder={t.onboarding.serviceAreaHint} maxLength={100} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="category">{t.onboarding.category}</Label>
        <Input id="category" name="category" placeholder={t.onboarding.categoryHint} maxLength={100} />
      </div>
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
