import { Card } from "@/components/ui/card";
import { t } from "@/lib/i18n/en";
import { requireUser } from "@/server/org/current";
import { OnboardingForm } from "./onboarding-form";

export default async function OnboardingPage() {
  await requireUser();
  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center px-4 py-16">
      <Card className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold">{t.onboarding.title}</h1>
        <p className="text-sm opacity-80">{t.onboarding.body}</p>
        <OnboardingForm />
      </Card>
    </main>
  );
}
