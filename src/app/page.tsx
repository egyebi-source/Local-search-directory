import Link from "next/link";
import { getPricing, monthsFree, usd, type Pricing } from "@/server/billing/pricing";
import { DashboardPreview } from "@/components/marketing/dashboard-preview";
import { Logo } from "@/components/marketing/logo";
import { WebsiteForm } from "@/components/marketing/website-form";

const STEPS = [
  {
    title: "Enter your website",
    body: "We look up who's buying Google ads for the services you offer in your area, and what they pay per click.",
  },
  {
    title: "See your rescue targets",
    body: "The searches where you're already on page 2 or 3 — and your competitors are paying to show up. These are your fastest wins.",
  },
  {
    title: "Get this week's fix list",
    body: "A short, prioritized checklist in plain English, with ready-to-use wording for your website and Google profile.",
  },
];

const FEATURES = [
  {
    title: "Competitor ad intelligence",
    body: "Which keywords rivals in your area pay for, and roughly what they spend. Know where the money is before you spend yours.",
    icon: "M3 17l6-6 4 4 8-8M15 7h6v6",
  },
  {
    title: "Your real Google results",
    body: "Connect Search Console and Analytics in two clicks to see actual clicks, calls and form leads — not guesses.",
    icon: "M4 19V9m6 10V5m6 14v-7m4 7H2",
  },
  {
    title: "Rescue targets",
    body: "Keywords where a small push moves you from page 2 to page 1 — ranked by what each click would cost you in ads.",
    icon: "M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z",
  },
  {
    title: "A weekly action checklist",
    body: "Clear next steps with suggested copy you can paste in, written for a business owner — not an SEO expert.",
    icon: "M9 11l3 3 8-8M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9",
  },
];

const TRADES = [
  "Collision & auto body",
  "Mechanics",
  "HVAC",
  "Plumbing",
  "Electrical",
  "Roofing",
  "Landscaping",
  "Machine shops",
  "Metal fabrication",
  "Custom manufacturing",
];

function plansFor(p: Pricing) {
  const free = monthsFree(p);
  return [
    { name: "Monthly", price: usd(p.monthlyCents), period: "USD /month", note: "Billed monthly", highlight: false },
    {
      name: "Annual",
      price: usd(p.annualCents),
      period: "USD /year",
      note: `About ${usd(Math.round(p.annualCents / 12))} USD a month, billed yearly${free > 0 ? ` (${free} month${free === 1 ? "" : "s"} free)` : ""}`,
      highlight: true,
    },
  ];
}

const INCLUDED = [
  "Full dashboard for one business",
  "Competitor ad intelligence for your area",
  "Google Search Console & Analytics connection",
  "Rescue targets and weekly action checklist",
  "Invite your team or agency",
];

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

export default async function Home() {
  // Prices are set in the admin console.
  const pricing = await getPricing();
  const plans = plansFor(pricing);
  return (
    <div className="flex flex-1 flex-col bg-white text-slate-900">
      {/* Hero */}
      <section className="relative overflow-hidden border-b border-rose-100 bg-gradient-to-b from-rose-50/70 via-white to-white">
        <div aria-hidden="true" className="pointer-events-none absolute -right-40 -top-40 h-[32rem] w-[32rem] rounded-full bg-gold-200/40 blur-3xl" />
        <div aria-hidden="true" className="pointer-events-none absolute -left-40 top-40 h-[26rem] w-[26rem] rounded-full bg-rose-200/40 blur-3xl" />
        <header className="relative mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-5">
          <Logo className="text-lg" />
          <Link href="/login" className="rounded-md px-3 py-2 text-sm font-medium text-slate-700 hover:text-rose-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-300">
            Sign in
          </Link>
        </header>

        <div className="relative mx-auto grid w-full max-w-6xl items-center gap-12 px-4 pb-20 pt-8 lg:grid-cols-2 lg:pb-28 lg:pt-12">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-gold-700">
              For body shops, trades &amp; local manufacturers
            </p>
            <h1 className="mt-4 text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
              Turn Google searches into <span className="text-rose-700">phone calls.</span>
            </h1>
            <p className="mt-5 max-w-xl text-lg text-slate-600">
              See which searches your competitors pay for, where you&apos;re one push from page one, and exactly what to
              fix this week — in plain English.
            </p>
            <WebsiteForm id="hero-website" className="mt-8 max-w-xl" />
            <p className="mt-3 text-sm text-slate-500">Free assessment · 7-day free trial · No credit card</p>
          </div>
          <DashboardPreview />
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto w-full max-w-6xl px-4 py-20" aria-labelledby="how">
        <h2 id="how" className="text-center text-3xl font-bold tracking-tight">
          How it works
        </h2>
        <ol className="mt-12 grid gap-8 md:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="flex flex-col gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-gold-500 font-bold text-slate-950">{i + 1}</span>
              <h3 className="text-lg font-semibold">{s.title}</h3>
              <p className="text-slate-600">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Features */}
      <section className="bg-gradient-to-b from-white via-rose-50/40 to-white" aria-labelledby="features">
        <div className="mx-auto w-full max-w-6xl px-4 py-20">
          <h2 id="features" className="max-w-2xl text-3xl font-bold tracking-tight">
            Everything you need to win local search — nothing you don&apos;t
          </h2>
          <div className="mt-12 grid gap-6 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <div key={f.title} className="rounded-xl bg-white p-6 ring-1 ring-slate-200">
                <span className="inline-flex h-11 w-11 items-center justify-center rounded-lg bg-rose-50 text-rose-700 ring-1 ring-rose-100">
                  <Icon d={f.icon} />
                </span>
                <h3 className="mt-4 text-lg font-semibold">{f.title}</h3>
                <p className="mt-2 text-slate-600">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Trust */}
      <section className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-20 md:grid-cols-2" aria-labelledby="trust">
        <div>
          <h2 id="trust" className="text-3xl font-bold tracking-tight">
            Your Google account stays yours
          </h2>
          <p className="mt-4 text-slate-600">
            When you connect Search Console or Analytics, you approve access on Google&apos;s own page. We never see your
            password, and you can disconnect in one click.
          </p>
        </div>
        <ul className="flex flex-col gap-4">
          {[
            "Read-only access — we can't change anything in your Google account",
            "Your data is never sold, never used for ads, never used to train AI",
            "Each business's data is kept strictly separate",
            "Delete your account and data any time, yourself",
          ].map((item) => (
            <li key={item} className="flex gap-3">
              <svg viewBox="0 0 24 24" aria-hidden="true" className="mt-0.5 h-5 w-5 shrink-0 text-gold-600" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M5 12l5 5L20 7" />
              </svg>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Who it's for */}
      <section className="border-y border-gold-100 bg-gold-50/40" aria-labelledby="who">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 text-center">
          <h2 id="who" className="text-2xl font-bold tracking-tight">
            Built for businesses that get work from local searches
          </h2>
          <ul className="mx-auto mt-8 flex max-w-3xl flex-wrap justify-center gap-2">
            {TRADES.map((t) => (
              <li key={t} className="rounded-full bg-white px-4 py-1.5 text-sm ring-1 ring-slate-200">
                {t}
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Pricing */}
      <section className="mx-auto w-full max-w-6xl px-4 py-20" aria-labelledby="pricing">
        <h2 id="pricing" className="text-center text-3xl font-bold tracking-tight">
          Simple pricing
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-center text-slate-600">
          Start with a free 7-day trial of the full dashboard. No credit card. Cancel any time.
        </p>
        <div className="mx-auto mt-10 grid max-w-3xl gap-6 md:grid-cols-2">
          {plans.map((p) => (
            <div
              key={p.name}
              className={
                p.highlight
                  ? "relative flex flex-col rounded-2xl bg-white p-8 shadow-xl shadow-rose-100 ring-2 ring-gold-500"
                  : "flex flex-col rounded-2xl bg-white p-8 ring-1 ring-slate-200"
              }
            >
              {p.highlight ? (
                <span className="absolute -top-3 left-8 rounded-full bg-gold-500 px-3 py-0.5 text-xs font-semibold text-slate-950">
                  2 months free
                </span>
              ) : null}
              <h3 className="text-lg font-semibold">{p.name}</h3>
              <p className="mt-4 flex items-baseline gap-1">
                <span className="text-4xl font-bold tracking-tight">{p.price}</span>
                <span className="text-slate-600">{p.period}</span>
              </p>
              <p className="mt-1 text-sm text-slate-600">{p.note}</p>
              <ul className="mt-6 flex flex-col gap-2 text-sm">
                {INCLUDED.map((item) => (
                  <li key={item} className="flex gap-2">
                    <svg viewBox="0 0 24 24" aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-gold-600" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M5 12l5 5L20 7" />
                    </svg>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-6 text-center text-xs text-slate-500">Prices in US dollars. Your bank converts to your currency. Applicable taxes extra.</p>
      </section>

      {/* Final CTA */}
      <section className="border-t border-rose-100 bg-gradient-to-b from-white to-rose-50/70" aria-labelledby="cta">
        <div className="mx-auto flex w-full max-w-3xl flex-col items-center px-4 py-20 text-center">
          <h2 id="cta" className="text-3xl font-bold tracking-tight sm:text-4xl">
            See what you&apos;re missing in under a minute
          </h2>
          <p className="mt-4 text-lg text-slate-600">
            Free assessment, then a 7-day free trial of the full dashboard. No credit card. Then {usd(pricing.monthlyCents)} USD/month or {usd(pricing.annualCents)} USD/year.
          </p>
          <WebsiteForm id="cta-website" className="mt-8 max-w-xl" />
        </div>
      </section>

      <footer className="border-t border-slate-200">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 px-4 py-6 text-sm text-slate-600 sm:flex-row">
          <Logo />
          <p>© {new Date().getFullYear()} TorqueRank · Made in Canada</p>
        </div>
      </footer>
    </div>
  );
}
