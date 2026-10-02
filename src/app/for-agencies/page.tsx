import type { Metadata } from "next";
import Link from "next/link";
import { Logo } from "@/components/marketing/logo";
import { getPricing, usd } from "@/server/billing/pricing";

// Public page for agencies, buying groups, franchise networks and consultants
// who look after many local businesses. Every claim here is something the
// product does today; no invented customers or results.

export const metadata: Metadata = {
  title: "TorqueRank for agencies and shop networks",
  description:
    "One login for every shop you look after or want to win: Google Maps rank, the competitors above them, the searches they're missing, and a plan you can hand over.",
};

const START = "/login?callbackUrl=/agency";

function Check() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-rose-600" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12l5 5L20 7" />
    </svg>
  );
}

export default async function ForAgencies() {
  const pricing = await getPricing();

  return (
    <div className="flex flex-1 flex-col bg-white text-slate-900">
      <header className="border-b border-slate-200">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-4">
          <Link href="/" aria-label="TorqueRank home">
            <Logo className="text-lg" />
          </Link>
          <nav className="flex items-center gap-5 text-sm text-slate-700">
            <Link href="/" className="hidden hover:text-rose-700 sm:inline">
              For shop owners
            </Link>
            <Link href="/help#agency-start" className="hidden hover:text-rose-700 sm:inline">
              Agency guide
            </Link>
            <Link href={START} className="font-medium text-rose-700 hover:text-rose-800">
              Sign in
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto w-full max-w-4xl px-4 pb-16 pt-14 lg:pt-20">
        <p className="flex items-center gap-3 text-sm font-medium text-gold-700">
          <span aria-hidden="true" className="h-px w-8 bg-gold-500" />
          For agencies, buying groups, franchise networks and consultants
        </p>
        <h1 className="mt-5 text-[2.4rem] font-medium leading-[1.08] sm:text-6xl">
          Walk into every shop with <em className="text-rose-700">its own</em> numbers.
        </h1>
        <p className="mt-6 max-w-2xl text-lg leading-relaxed text-slate-700">
          Add any local business by its website and city. TorqueRank shows where it sits in Google Maps, which shops are above it and how many
          reviews they have, the searches its competitors win, and the short list of fixes that would move it up. Use it to win new members
          and clients, then to show them what changed.
        </p>
        <div className="mt-8 flex flex-wrap items-center gap-4">
          <Link href={START} className="rounded-lg bg-rose-600 px-5 py-3 font-medium text-white hover:bg-rose-700">
            Start your agency workspace
          </Link>
          <span className="text-sm text-slate-500">14 days free, up to 10 locations. No card.</span>
        </div>
      </section>

      {/* Two uses */}
      <section className="border-y border-slate-200 bg-gold-50/40">
        <div className="mx-auto grid w-full max-w-6xl gap-12 px-4 py-16 md:grid-cols-2">
          <div>
            <p className="text-sm font-medium uppercase tracking-wider text-rose-700">Before the meeting</p>
            <h2 className="mt-3 text-3xl font-medium leading-tight">Pitch with proof, not a brochure.</h2>
            <ol className="mt-6 flex flex-col gap-4 text-lg leading-relaxed text-slate-700">
              <li>
                <strong>1.</strong> Add the shop you want to win: name, website, main service and city.
              </li>
              <li>
                <strong>2.</strong> Open <em>Competitors</em> and run a check. We list the shops above it in Google Maps, with their ratings and
                review counts, and the searches they get found for.
              </li>
              <li>
                <strong>3.</strong> Bring the owner one page: &ldquo;You&apos;re #9 for collision repair in your city. These three shops are above
                you. Here&apos;s what we&apos;d fix first.&rdquo;
              </li>
            </ol>
          </div>
          <div>
            <p className="text-sm font-medium uppercase tracking-wider text-rose-700">After they sign</p>
            <h2 className="mt-3 text-3xl font-medium leading-tight">One login for every location.</h2>
            <ul className="mt-6 flex flex-col gap-4 text-lg leading-relaxed text-slate-700">
              {[
                "See every location's Google Maps spot and ranking, checked daily, on one screen.",
                "Open any location to work its keyword plan and weekly to-do list.",
                "Before-and-after charts for each change, so renewals sell themselves.",
                "Hand the owner their own login whenever you like. Their data stays theirs.",
              ].map((item) => (
                <li key={item} className="flex gap-3">
                  <Check />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* Trust */}
      <section className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-20 md:grid-cols-[1fr_1.4fr]">
        <h2 className="text-3xl font-medium leading-tight">Owners stay in control.</h2>
        <ul className="flex flex-col gap-4 text-lg leading-relaxed text-slate-700">
          {[
            "Before signing, you only see public information: Google Maps, search rankings and ads anyone can look up.",
            "A business already on TorqueRank joins your workspace only with a one-time code the owner gives you.",
            "Private Google data (Search Console, Analytics) is connected by the owner on Google's own page, read-only.",
            "The owner can remove your access at any time, in two clicks.",
          ].map((item) => (
            <li key={item} className="flex gap-3">
              <Check />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Pricing */}
      <section className="border-t border-slate-200 bg-rose-50/50">
        <div className="mx-auto flex w-full max-w-3xl flex-col items-start px-4 py-20 sm:items-center sm:text-center">
          <h2 className="text-3xl font-medium leading-tight">Pay per location. Charge what you like.</h2>
          <p className="mt-6 font-display text-6xl font-medium">
            {usd(pricing.agencyCents)}
            <span className="ml-2 font-sans text-lg font-normal text-slate-500">per location / month</span>
          </p>
          <p className="mt-3 text-slate-700">
            Minimum {pricing.agencyMinLocations} locations after the free trial. Prices in US dollars, taxes extra.
          </p>
          <Link href={START} className="mt-8 rounded-lg bg-rose-600 px-5 py-3 font-medium text-white hover:bg-rose-700">
            Start your agency workspace
          </Link>
          <p className="mt-4 text-sm text-slate-600">
            Step by step:{" "}
            <Link href="/help#agency-start" className="text-rose-700 underline">
              the agency guide
            </Link>
          </p>
        </div>
      </section>

      <footer className="border-t border-slate-200">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 px-4 py-6 text-sm text-slate-600 sm:flex-row">
          <Logo />
          <nav className="flex gap-5">
            <Link href="/help" className="hover:text-rose-700">
              Help
            </Link>
            <Link href={START} className="hover:text-rose-700">
              Sign in
            </Link>
          </nav>
          <p>© {new Date().getFullYear()} TorqueRank · Made in Canada</p>
        </div>
      </footer>
    </div>
  );
}
