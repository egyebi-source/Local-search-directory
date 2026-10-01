import { Card } from "@/components/ui/card";
import { t } from "@/lib/i18n/en";

export default function CheckEmailPage() {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-4 py-16">
      <Card className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold">{t.login.checkTitle}</h1>
        <p>{t.login.checkBody}</p>
      </Card>
    </main>
  );
}
