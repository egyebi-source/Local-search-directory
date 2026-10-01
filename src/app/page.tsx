import Link from "next/link";
import { t } from "@/lib/i18n/en";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-4 px-4 py-16">
      <h1 className="text-3xl font-semibold">{t.appName}</h1>
      <p className="text-lg">
        Is your online presence producing clicks, visits and leads — and what should you fix this
        week?
      </p>
      <p>
        <Link href="/login" className="font-medium text-blue-700 underline dark:text-blue-400">
          Sign in
        </Link>
      </p>
    </main>
  );
}
