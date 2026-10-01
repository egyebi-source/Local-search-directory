"use client";

import Script from "next/script";
import { useActionState, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/lib/i18n/en";
import { cn } from "@/lib/utils";
import { saveAnswersAction, type StartState } from "./actions";

const q = t.start.questions;
const o = t.onboarding;

function Choices<T extends string>({ name, options, labels }: { name: string; options: readonly T[]; labels: Record<T, string> }) {
  return (
    <div className="flex flex-col gap-2">
      {options.map((value) => (
        <label
          key={value}
          className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-300 px-4 py-3 text-base transition-colors hover:border-amber-500 has-checked:border-amber-500 has-checked:bg-amber-50 has-checked:ring-1 has-checked:ring-amber-500 dark:border-slate-700 dark:has-checked:bg-amber-500/10"
        >
          <input type="radio" name={name} value={value} required className="h-4 w-4 accent-amber-600" />
          {labels[value]}
        </label>
      ))}
    </div>
  );
}

export function QuestionsForm({
  website,
  turnstileSiteKey,
  nonce,
}: {
  website: string;
  turnstileSiteKey: string | null;
  nonce?: string;
}) {
  const [state, action, pending] = useActionState<StartState, FormData>(saveAnswersAction, {});
  const [step, setStep] = useState(0);
  const [reach, setReach] = useState<"local" | "national">("local");
  const stepRefs = useRef<(HTMLFieldSetElement | null)[]>([]);

  const steps: { title: string; body: React.ReactNode }[] = [
    {
      title: q.business,
      body: (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="name">{o.name}</Label>
            <Input id="name" name="name" required minLength={2} maxLength={100} autoFocus />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="website">{o.website}</Label>
            <Input id="website" name="website" required maxLength={253} inputMode="url" defaultValue={website} />
          </div>
        </div>
      ),
    },
    {
      title: q.category,
      body: <Input aria-label={o.category} name="category" required minLength={2} maxLength={100} placeholder={o.categoryHint} />,
    },
    {
      title: q.serviceArea,
      body: (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2" role="radiogroup" aria-label={q.serviceArea}>
            {(["local", "national"] as const).map((value) => (
              <label
                key={value}
                className="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-300 px-4 py-3 text-base transition-colors hover:border-amber-500 has-checked:border-amber-500 has-checked:bg-amber-50 has-checked:ring-1 has-checked:ring-amber-500 dark:border-slate-700 dark:has-checked:bg-amber-500/10"
              >
                <input
                  type="radio"
                  name="reach"
                  value={value}
                  checked={reach === value}
                  onChange={() => setReach(value)}
                  className="h-4 w-4 accent-amber-600"
                />
                {t.start.reach[value]}
              </label>
            ))}
          </div>
          {reach === "local" ? (
            <Input aria-label={o.serviceArea} name="serviceArea" required minLength={2} maxLength={100} placeholder={o.serviceAreaHint} />
          ) : null}
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1 text-sm font-medium">{t.start.country.label}</legend>
            <Choices name="country" options={["CA", "US"] as const} labels={t.start.country} />
          </fieldset>
        </div>
      ),
    },
    {
      title: q.goal,
      body: <Choices name="primaryGoal" options={["calls", "form_leads", "walk_ins", "lower_ad_spend"] as const} labels={o.goal} />,
    },
    {
      title: q.adSpend,
      body: (
        <Choices
          name="adSpendRange"
          options={["none", "under_500", "500_2000", "2000_5000", "over_5000"] as const}
          labels={o.adSpend}
        />
      ),
    },
    {
      title: q.manager,
      body: (
        <div className="flex flex-col gap-4">
          <Choices name="websiteManager" options={["self", "agency", "nobody"] as const} labels={o.manager} />
          {/* Cloudflare's bot check; it adds a hidden "cf-turnstile-response" field to the form. */}
          {turnstileSiteKey ? <div className="cf-turnstile" data-sitekey={turnstileSiteKey} data-theme="auto" /> : null}
        </div>
      ),
    },
  ];
  const last = steps.length - 1;

  function next() {
    const fields = stepRefs.current[step]?.querySelectorAll("input") ?? [];
    for (const field of fields) if (!field.reportValidity()) return;
    setStep((s) => Math.min(s + 1, last));
  }

  return (
    <form action={action} className="flex flex-col gap-6">
      {turnstileSiteKey ? (
        <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" nonce={nonce} />
      ) : null}
      <div>
        <p className="text-sm font-medium text-slate-600 dark:text-slate-400">{t.start.stepOf(step + 1, steps.length)}</p>
        <div className="mt-2 grid grid-cols-6 gap-1.5" aria-hidden="true">
          {steps.map((_, i) => (
            <span key={i} className={cn("h-1.5 rounded-full", i <= step ? "bg-amber-500" : "bg-slate-200 dark:bg-slate-700")} />
          ))}
        </div>
      </div>

      {/* Every step stays in the form so one submit sends all answers; only the current one is shown. */}
      {steps.map((s, i) => (
        <fieldset
          key={s.title}
          ref={(el) => {
            stepRefs.current[i] = el;
          }}
          className={cn("flex flex-col gap-4", i !== step && "hidden")}
          disabled={pending}
        >
          <legend className="mb-4 text-2xl font-semibold tracking-tight">{s.title}</legend>
          {s.body}
        </fieldset>
      ))}

      {state.error ? (
        <p role="alert" className="text-sm text-red-700 dark:text-red-400">
          {state.error}
        </p>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <Button type="button" variant="ghost" onClick={() => setStep((s) => Math.max(s - 1, 0))} className={cn(step === 0 && "invisible")}>
          {t.start.back}
        </Button>
        {step < last ? (
          <Button type="button" onClick={next} className="bg-amber-500 text-slate-950 hover:bg-amber-400">
            {t.start.next}
          </Button>
        ) : (
          <Button type="submit" disabled={pending} className="bg-amber-500 text-slate-950 hover:bg-amber-400">
            {pending ? t.start.analyzing : t.start.finish}
          </Button>
        )}
      </div>
    </form>
  );
}
