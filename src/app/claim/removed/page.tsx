import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Report deleted", robots: { index: false, follow: false } };

export default function RemovedPage() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-start gap-4 px-4 py-16">
      <h1 className="text-2xl font-semibold">Done. Your report has been deleted.</h1>
      <p className="text-slate-600 dark:text-slate-400">We won&apos;t contact this business again about TorqueRank.</p>
      <Link href="/" className="text-sm underline">
        TorqueRank home
      </Link>
    </main>
  );
}
