import Link from "next/link";
import googleData from "@/assets/screens/google-data.png";
import keywordTopic from "@/assets/screens/keyword-topic.png";
import progress from "@/assets/screens/progress.png";
import { Logo } from "@/components/marketing/logo";
import { WebsiteForm } from "@/components/marketing/website-form";
import { getPricing, monthsFree, usd } from "@/server/billing/pricing";

// The landing page. Written for a shop owner, in their words; every picture
// is a real screenshot of the product (demo shop, fictional numbers).

const INCLUDED = [
  "Your Google Maps spot and ranking, checked every day",
  "Which searches your competitors pay for, and what a click costs",
  "A keyword plan with the exact page or title to change",
  "A short to-do list each week, with wording you can paste",
  "Your own Search Console and Analytics numbers (read-only)",
  "Before and after, for every change you make",
];

function Check() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="mt-1 h-4 w-4 shrink-0 text-rose-600" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12l5 5L20 7" />
    </svg>
  );
}

function Shot({ src, alt, caption, className = "", eager = false }: { src: typeof googleData; alt: string; caption: string; className?: string; eager?: boolean }) {
  return (
    <figure className={className}>
      <div className="relative">
        <div aria-hidden="true" className="absolute -bottom-3 -right-3 h-full w-full rounded-lg border border-gold-300" />
        {/* A plain <img>: next/image adds an inline style attribute, which our CSP forbids. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src.src}
          width={src.width}
          height={src.height}
          alt={alt}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          className="relative h-auto w-full rounded-lg border border-slate-200 bg-white shadow-sm"
        />
      </div>
      <figcaption className="mt-5 font-display text-sm italic text-slate-500">{caption}</figcaption>
    </figure>
  );
}

export default async function Home() {
  // Prices are set in the admin console.
  const pricing = await getPricing();
  const free = monthsFree(pricing);

  return (
    <div className="flex flex-1 flex-col bg-white text-slate-900">
      <header className="border-b border-slate-200">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-4">
          <Logo className="text-lg" />
          <nav className="flex items-center gap-5 text-sm text-slate-700">
            <a href="#how" className="hidden hover:text-rose-700 sm:inline">
              How it works
            </a>
            <a href="#pricing" className="hidden hover:text-rose-700 sm:inline">
              Pricing
            </a>
            <Link href="/agency" className="hidden hover:text-rose-700 sm:inline">
              For agencies
            </Link>
            <Link href="/login" className="font-medium text-rose-700 hover:text-rose-800">
              Sign in
            </Link>
          </nav>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto grid w-full max-w-6xl gap-14 px-4 pb-20 pt-14 lg:grid-cols-[1.05fr_1fr] lg:items-center lg:pt-20">
        <div>
          <p className="flex items-center gap-3 text-sm font-medium text-gold-700">
            <span aria-hidden="true" className="h-px w-8 bg-gold-500" />
            For collision shops, mechanics and other local trades
          </p>
          <h1 className="mt-5 text-[2.6rem] font-medium leading-[1.08] sm:text-6xl">
            Someone near you is paying Google for <em className="text-rose-700">your</em> customers.
          </h1>
          <p className="mt-6 max-w-xl text-lg leading-relaxed text-slate-700">
            Every day, people search &ldquo;collision repair near me&rdquo; and call whoever shows up first. Often that&apos;s a shop
            paying for the ad. TorqueRank shows you which searches they&apos;re buying, where you already rank for free, and the one or two
            fixes that will move you up.
          </p>
          <WebsiteForm id="hero-website" className="mt-8 max-w-xl" />
          <p className="mt-3 text-sm text-slate-500">Free check. No card. It takes about a minute.</p>
        </div>
        <Shot
          src={googleData}
          alt="TorqueRank dashboard: clicks from Google, times seen, average position, visits and key actions, a daily clicks chart, and the searches people used."
          caption="The dashboard of our demo shop, Acme Collision. Its numbers are made up; yours won't be."
          eager
        />
      </section>

      {/* First minute */}
      <section className="border-y border-slate-200 bg-gold-50/40">
        <div className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-16 lg:grid-cols-[1fr_1.6fr]">
          <div>
            <h2 className="text-3xl font-medium leading-tight">What you&apos;ll know a minute from now</h2>
            <p className="mt-3 text-sm text-slate-500">From a sample report on a fictional Ottawa body shop.</p>
          </div>
          <ol className="flex flex-col divide-y divide-gold-200 border-y border-gold-200">
            {[
              <>
                You&apos;re <strong>#9 in Google Maps</strong> for &ldquo;collision repair ottawa&rdquo;. The three shops above you average{" "}
                <strong>418 reviews</strong>. You have 48.
              </>,
              <>
                Two competitors pay about <strong>$9.80 every time</strong> someone clicks their ad for that search.
              </>,
              <>
                You&apos;re on page 2 for &ldquo;collision repair near me&rdquo;, which <strong>1,900 people</strong> search every month. One new
                page could fix that.
              </>,
            ].map((line, i) => (
              <li key={i} className="flex gap-5 py-5 text-lg leading-relaxed">
                <span className="font-display text-2xl italic text-gold-600">{i + 1}</span>
                <span>{line}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="mx-auto w-full max-w-6xl scroll-mt-6 px-4 py-24">
        <div className="grid items-center gap-14 lg:grid-cols-2">
          <div>
            <p className="text-sm font-medium uppercase tracking-wider text-rose-700">Every week</p>
            <h2 className="mt-3 text-4xl font-medium leading-tight">It tells you exactly what to change.</h2>
            <p className="mt-5 text-lg leading-relaxed text-slate-700">
              Not &ldquo;improve your SEO&rdquo;. The page to add, the title to use, the words people actually type, and why. Hand it to
              your web person, or do it yourself in an afternoon.
            </p>
          </div>
          <Shot
            src={keywordTopic}
            alt="A keyword plan topic: bumper repair, 920 searches a month, who pays for ads, and the exact page to add."
            caption="One topic from a keyword plan: what people search, who pays for it, and the page to add."
          />
        </div>

        <div className="mt-28 grid items-center gap-14 lg:grid-cols-2">
          <Shot
            src={progress}
            alt="Progress chart for collision repair ottawa: Google Maps spot from #9 to #4 and Google position from #14 to #6, with a before-and-after table."
            caption="Sixty days of daily checks, with each change marked on the chart."
            className="lg:order-1"
          />
          <div className="lg:order-2">
            <p className="text-sm font-medium uppercase tracking-wider text-rose-700">Every day</p>
            <h2 className="mt-3 text-4xl font-medium leading-tight">And it shows you whether it worked.</h2>
            <p className="mt-5 text-lg leading-relaxed text-slate-700">
              We check your Google Maps spot and your ranking every morning. Your first check is your &ldquo;before&rdquo;. Note what you
              changed, and you&apos;ll see what moved after it, in plain numbers.
            </p>
          </div>
        </div>
      </section>

      {/* Why */}
      <section className="border-t border-slate-200 bg-rose-50/50">
        <div className="mx-auto w-full max-w-3xl px-4 py-20">
          <h2 className="text-sm font-medium uppercase tracking-wider text-rose-700">Why we built it</h2>
          <blockquote className="mt-5 font-display text-2xl leading-relaxed text-slate-800 sm:text-[1.7rem]">
            Most SEO tools are made for marketing agencies: hundreds of charts and a vocabulary nobody at a body shop has time to learn. We
            wanted the opposite. One page, plain words, and a short list of things to do on Monday morning.
          </blockquote>
          <p className="mt-5 text-sm text-slate-600">The TorqueRank team</p>
        </div>
      </section>

      {/* Trust */}
      <section className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-20 md:grid-cols-[1fr_1.4fr]">
        <h2 className="text-3xl font-medium leading-tight">Your Google account stays yours.</h2>
        <ul className="flex flex-col gap-4 text-lg leading-relaxed text-slate-700">
          {[
            "You approve access on Google's own page. We never see your password.",
            "Read-only. We can't change your website, your ads or your Google settings.",
            "Your numbers are never sold, never used for ads, and never used to train AI.",
            "Disconnect, or delete your account and data, whenever you like.",
          ].map((item) => (
            <li key={item} className="flex gap-3">
              <Check />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Pricing */}
      <section id="pricing" className="scroll-mt-6 border-t border-slate-200">
        <div className="mx-auto grid w-full max-w-6xl gap-12 px-4 py-20 lg:grid-cols-[1fr_1.4fr]">
          <div>
            <h2 className="text-3xl font-medium leading-tight">One price. Everything in it.</h2>
            <p className="mt-6 font-display text-6xl font-medium">
              {usd(pricing.monthlyCents)}
              <span className="ml-2 font-sans text-lg font-normal text-slate-500">a month</span>
            </p>
            <p className="mt-3 text-slate-700">
              Or {usd(pricing.annualCents)} a year{free > 0 ? ` (${free} month${free === 1 ? "" : "s"} free)` : ""}. Prices in US dollars,
              taxes extra.
            </p>
            <p className="mt-1 text-slate-700">
              Agencies: {usd(pricing.agencyCents)} per location.{" "}
              <Link href="/help#agency-start" className="text-rose-700 underline">
                How that works
              </Link>
            </p>
            <p className="mt-6 inline-block border-l-2 border-gold-500 pl-3 text-sm text-slate-600">
              The first 7 days are free, with no card. Cancel from your billing page in two clicks.
            </p>
          </div>
          <ul className="grid content-start gap-x-8 gap-y-4 sm:grid-cols-2">
            {INCLUDED.map((item) => (
              <li key={item} className="flex gap-3 text-slate-700">
                <Check />
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Final call */}
      <section className="border-t border-slate-200 bg-gold-50/40">
        <div className="mx-auto flex w-full max-w-3xl flex-col items-start px-4 py-20 sm:items-center sm:text-center">
          <h2 className="text-4xl font-medium leading-tight">Find out who&apos;s taking your calls.</h2>
          <p className="mt-4 text-lg text-slate-700">Enter your website. You&apos;ll see your first results before your coffee&apos;s cold.</p>
          <WebsiteForm id="cta-website" className="mt-8 max-w-xl" />
        </div>
      </section>

      <footer className="border-t border-slate-200">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-3 px-4 py-6 text-sm text-slate-600 sm:flex-row">
          <Logo />
          <nav className="flex gap-5">
            <Link href="/help" className="hover:text-rose-700">
              Help
            </Link>
            <Link href="/login" className="hover:text-rose-700">
              Sign in
            </Link>
          </nav>
          <p>© {new Date().getFullYear()} TorqueRank · Made in Canada</p>
        </div>
      </footer>
    </div>
  );
}
