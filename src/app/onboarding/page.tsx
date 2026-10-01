import { Card } from "@/components/ui/card";
import { normalizeDomain } from "@/lib/domain";
import { t } from "@/lib/i18n/en";
import { requireUser } from "@/server/org/current";
import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  await requireUser();
  const { website } = await searchParams;
  // Carried over from the home-page website box; re-validated, never trusted.
  const prefill = typeof website === "string" ? (normalizeDomain(website) ?? undefined) : undefined;
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-16">
      <Card className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">{t.onboarding.title}</h1>
        <p className="text-sm opacity-80">{t.onboarding.body}</p>
        <OnboardingForm defaults={{ website: prefill }} />
      </Card>
    </main>
  );
}
