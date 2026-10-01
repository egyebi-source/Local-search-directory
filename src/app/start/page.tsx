import { headers } from "next/headers";
import Link from "next/link";
import { Logo } from "@/components/marketing/logo";
import { normalizeDomain } from "@/lib/domain";
import { t } from "@/lib/i18n/en";
import { turnstileBypassed, turnstileSiteKey } from "@/server/security/turnstile";
import { QuestionsForm } from "./questions-form";

// Public: the questions come before account creation (PRD §2.1).
export default async function StartPage({ searchParams }: PageProps<"/start">) {
  const { website } = await searchParams;
  const prefill = typeof website === "string" ? (normalizeDomain(website) ?? "") : "";
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const siteKey = turnstileBypassed() ? null : turnstileSiteKey();

  return (
    <div className="flex flex-1 flex-col bg-slate-50 dark:bg-slate-950">
      <header className="mx-auto flex w-full max-w-2xl items-center px-4 py-5">
        <Link href="/" className="text-slate-900 dark:text-white">
          <Logo className="text-lg" />
        </Link>
      </header>
      <main className="mx-auto w-full max-w-xl flex-1 px-4 pb-16 pt-4">
        <p className="mb-6 text-slate-600 dark:text-slate-300">{t.start.intro}</p>
        <div className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 sm:p-8 dark:bg-slate-900 dark:ring-slate-800">
          <QuestionsForm website={prefill} turnstileSiteKey={siteKey} nonce={nonce} />
        </div>
      </main>
    </div>
  );
}
