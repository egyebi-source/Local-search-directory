import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { Logo } from "@/components/marketing/logo";

export const metadata: Metadata = {
  title: "Help: connecting your accounts",
  description: "Step-by-step instructions for business owners and agencies: connecting Google Search Console and Analytics, giving an agency access, and managing clients.",
};

// Plain-English instructions for business owners and agencies. Public (no
// account data), so people can read it before signing up or share the link.

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} className="scroll-mt-6 flex flex-col gap-3 rounded-xl bg-white p-5 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
      <h3 className="text-lg font-semibold">{title}</h3>
      <div className="flex flex-col gap-3 text-[15px] leading-relaxed text-slate-800 dark:text-slate-200">{children}</div>
    </section>
  );
}

function Steps({ children }: { children: ReactNode }) {
  return <ol className="flex list-decimal flex-col gap-2 pl-6 marker:font-semibold">{children}</ol>;
}

function Note({ children }: { children: ReactNode }) {
  return <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-950 dark:bg-amber-950/60 dark:text-amber-100">{children}</p>;
}

function Where({ children }: { children: ReactNode }) {
  return <strong className="font-semibold">{children}</strong>;
}

const OWNER_TOPICS = [
  ["before-you-start", "Before you connect Google"],
  ["connect-google", "Connect Search Console and Analytics"],
  ["key-events", "Count calls and forms in GA4"],
  ["reconnect", "Reconnecting"],
  ["disconnect", "Disconnecting"],
  ["give-agency-access", "Give a marketing agency access"],
  ["remove-agency", "Remove an agency"],
  ["invite-team", "Invite your team"],
] as const;

const AGENCY_TOPICS = [
  ["agency-start", "Start your agency workspace"],
  ["add-client", "Add a new client"],
  ["connect-client", "Connect a business that already uses TorqueRank"],
  ["client-google", "Getting a client's Google data connected"],
  ["hand-over", "Give the business owner their own login"],
  ["agency-limits", "What agencies can and can't do"],
  ["stop-managing", "Stop managing a location"],
] as const;

function Toc({ title, items }: { title: string; items: readonly (readonly [string, string])[] }) {
  return (
    <nav aria-label={title} className="rounded-xl bg-white p-5 ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
      <h2 className="font-semibold">{title}</h2>
      <ul className="mt-2 flex flex-col gap-1 text-sm">
        {items.map(([id, label]) => (
          <li key={id}>
            <a href={`#${id}`} className="text-blue-700 underline dark:text-blue-400">
              {label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

export default function HelpPage() {
  return (
    <div className="flex flex-1 flex-col bg-slate-50 dark:bg-slate-950">
      <header className="mx-auto flex w-full max-w-4xl items-center justify-between gap-4 px-4 py-5">
        <Link href="/" className="text-slate-900 dark:text-white">
          <Logo className="text-lg" />
        </Link>
        <nav className="flex gap-4 text-sm">
          <Link href="/app" className="underline">
            My dashboard
          </Link>
          <Link href="/agency" className="underline">
            Agency workspace
          </Link>
        </nav>
      </header>

      <main className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 pb-16">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Help: connecting your accounts</h1>
          <p className="mt-2 text-slate-700 dark:text-slate-300">
            Step-by-step instructions for business owners and for marketing agencies. Nothing here asks for a password: Google accounts are
            always connected on Google&apos;s own screen.
          </p>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Toc title="For business owners" items={OWNER_TOPICS} />
          <Toc title="For agencies" items={AGENCY_TOPICS} />
        </div>

        <h2 className="mt-4 text-2xl font-semibold">For business owners</h2>

        <Section id="before-you-start" title="Before you connect Google">
          <p>You&apos;ll need:</p>
          <ul className="list-disc pl-6">
            <li>
              <Where>An owner login</Where> on TorqueRank for your business. Only owners can connect Google, because it&apos;s your Google
              account.
            </li>
            <li>
              <Where>Google Search Console</Where> set up for your website, where Google reports the searches that show your site. No account
              yet? Go to search.google.com/search-console, add your website, and follow Google&apos;s steps to verify it (usually a short
              record at your domain provider, or a file from your web designer). New sites show data after a few days.
            </li>
            <li>
              <Where>Google Analytics (GA4)</Where> on your website (optional but recommended), which shows visits and how many people called
              or filled in a form. Your web designer can usually add it in a few minutes.
            </li>
            <li>
              The <Where>Google account</Where> (email) that has access to them. If your web designer set them up, ask them to add your email
              as a user first: in Search Console, <em>Settings → Users and permissions</em>; in GA4, <em>Admin → Property access management</em>
              . &ldquo;Restricted&rdquo; or &ldquo;Viewer&rdquo; access is enough.
            </li>
          </ul>
          <Note>
            During early access, Google only lets approved email addresses connect. If Google says you don&apos;t have access, send us the
            Google email you use and we&apos;ll approve it.
          </Note>
        </Section>

        <Section id="connect-google" title="Connect Search Console and Analytics">
          <Steps>
            <li>
              Sign in to TorqueRank and open <Where>Google data</Where> in the top menu.
            </li>
            <li>
              Click <Where>Connect Google</Where>. You&apos;re taken to Google&apos;s own sign-in screen (the address starts with
              accounts.google.com).
            </li>
            <li>Choose the Google account that has your Search Console and Analytics.</li>
            <li>
              Google lists what TorqueRank is asking for: <em>view</em> Search Console data and <em>view</em> Google Analytics data. Tick both
              boxes and click <Where>Continue</Where>.
            </li>
            <li>
              Back on TorqueRank, pick your <Where>website</Where> and your <Where>GA4 property</Where>, then click <Where>Save</Where>.
            </li>
            <li>
              Give it a minute, then open your <Where>Dashboard</Where>: &ldquo;Your Google data&rdquo; now shows your real clicks, the words
              people searched, visits and key actions. It updates every night.
            </li>
          </Steps>
          <Note>
            While we&apos;re in early access, Google may show &ldquo;Google hasn&apos;t verified this app&rdquo;. Click <strong>Advanced</strong>{" "}
            then <strong>Continue</strong>. This goes away once Google finishes reviewing TorqueRank.
          </Note>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            What we can do with it: read your reports to build your dashboard and recommendations. What we can&apos;t: change your website,
            your Google settings, your ads or anything else. Your data is never sold, shared or used to train AI.
          </p>
        </Section>

        <Section id="key-events" title="Count calls and forms in GA4 (so you see leads, not just visits)">
          <p>
            GA4 calls a lead a <Where>key event</Where>. If your dashboard shows 0 key actions, GA4 isn&apos;t counting them yet:
          </p>
          <Steps>
            <li>
              In Google Analytics, go to <Where>Admin → Data display → Events</Where>.
            </li>
            <li>
              Find the event for your contact form (often <em>generate_lead</em> or <em>form_submit</em>) and your call button (often{" "}
              <em>click</em> on a &ldquo;tel:&rdquo; link), and switch on <Where>Mark as key event</Where>.
            </li>
            <li>Don&apos;t see them? Ask your web designer to set up a form event and a phone-click event. It&apos;s a small job.</li>
          </Steps>
          <p className="text-sm text-slate-600 dark:text-slate-400">New key events count from the day you switch them on.</p>
        </Section>

        <Section id="reconnect" title="Reconnecting">
          <p>
            If your dashboard says <Where>Reconnect needed</Where> (we also email you), Google stopped sharing data. This happens when access
            was removed, the Google password changed, or (during early access) after 7 days. Your saved numbers stay. Open{" "}
            <Where>Google data</Where>, click <Where>Reconnect Google</Where>, and follow the same steps.
          </p>
        </Section>

        <Section id="disconnect" title="Disconnecting">
          <Steps>
            <li>
              Open <Where>Google data</Where>, then <Where>Disconnect Google</Where>.
            </li>
            <li>Tick the box if you also want us to delete the numbers we&apos;ve saved, then click Disconnect.</li>
          </Steps>
          <p>
            We ask Google to cancel our access straight away. You can also remove TorqueRank yourself at any time in your Google account:{" "}
            <em>myaccount.google.com → Security → Your connections to third-party apps</em>.
          </p>
        </Section>

        <Section id="give-agency-access" title="Give a marketing agency access">
          <p>If an agency or freelancer handles your marketing, they can work in your TorqueRank account without your password:</p>
          <Steps>
            <li>
              Open <Where>Team</Where> and find <Where>Agency access</Where>.
            </li>
            <li>
              Click <Where>Create an access code</Where>. You&apos;ll see a code like <code>KEW5-84DM-YZAR</code>.
            </li>
            <li>Send the code to your agency (by phone, text or email). It works once and expires after 7 days.</li>
            <li>
              The agency enters it in their workspace. You&apos;ll see <Where>Managed by &lt;agency&gt;</Where> at the top of your dashboard.
            </li>
          </Steps>
          <p>
            Your agency can see and work on everything (dashboard, keyword plan, action plan, progress) and can invite helpers as members. They
            can&apos;t manage your billing, change your team&apos;s roles, make anyone an owner, or connect or disconnect your Google accounts.
            If they pay for your account, you don&apos;t need your own plan.
          </p>
        </Section>

        <Section id="remove-agency" title="Remove an agency">
          <Steps>
            <li>
              Open <Where>Team → Agency access → Remove agency access</Where>, then confirm.
            </li>
            <li>The agency loses access immediately. Your account, data and Google connection stay yours.</li>
          </Steps>
          <Note>If the agency was paying for your account, choose your own plan under Billing to keep using it.</Note>
        </Section>

        <Section id="invite-team" title="Invite your team">
          <Steps>
            <li>
              Open <Where>Team → Invite a teammate</Where>, enter their email and choose <Where>Member</Where> or <Where>Owner</Where>.
            </li>
            <li>They get an email link that works once, for 7 days, and only for that email address.</li>
          </Steps>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            Members see everything and can mark work done. Owners can also manage billing, the team, Google and agency access.
          </p>
        </Section>

        <h2 className="mt-4 text-2xl font-semibold">For agencies</h2>

        <Section id="agency-start" title="Start your agency workspace">
          <Steps>
            <li>
              Sign in (or create your login) and go to <Where>/agency</Where>, or <Where>Agency workspace</Where> at the top of this page.
            </li>
            <li>
              Enter your agency or network name and click <Where>Create my agency workspace</Where>.
            </li>
          </Steps>
          <p>
            The free trial lasts 14 days and covers up to 10 locations. After that you pay per location per month (the price is shown in your
            workspace) and can charge your clients whatever you like.
          </p>
        </Section>

        <Section id="add-client" title="Add a new client (a business not on TorqueRank yet)">
          <Steps>
            <li>
              In your workspace, fill in <Where>Add a new client</Where>: business name, website, main service (e.g. &ldquo;collision
              repair&rdquo;) and city.
            </li>
            <li>
              Click <Where>Add location</Where>. Tracking of &ldquo;service + city&rdquo; and a first action plan start straight away; rankings
              appear after the first nightly check.
            </li>
            <li>
              Click <Where>Open</Where> to work in it, and use <Where>Keyword plan</Where> to build its plan.
            </li>
          </Steps>
        </Section>

        <Section id="connect-client" title="Connect a business that already uses TorqueRank">
          <Steps>
            <li>
              Ask the owner to follow <a href="#give-agency-access" className="underline">Give a marketing agency access</a> and send you their
              code.
            </li>
            <li>
              In your workspace, paste it under <Where>Connect a business that already uses TorqueRank</Where> and click <Where>Connect</Where>.
            </li>
          </Steps>
          <p className="text-sm text-slate-600 dark:text-slate-400">
            &ldquo;That code didn&apos;t work&rdquo; means it was mistyped, already used, more than 7 days old, or the business is already
            managed by another agency. Ask the owner for a fresh code.
          </p>
        </Section>

        <Section id="client-google" title="Getting a client's Google data connected">
          <p>
            Google data is connected by the <Where>business owner</Where> on their own TorqueRank login, because it&apos;s their Google account
            and their consent. Agencies can&apos;t connect or disconnect it. Once connected, you see it on the client&apos;s dashboard like
            everything else.
          </p>
          <Steps>
            <li>
              If the business has no TorqueRank login yet, <a href="#hand-over" className="underline">give the owner their login</a> first.
            </li>
            <li>
              Send the owner the link to <a href="#connect-google" className="underline">Connect Search Console and Analytics</a> (a few
              clicks).
            </li>
            <li>
              If <em>you</em> set up their Search Console or GA4 under your agency&apos;s Google account, first add the owner&apos;s email as a
              user there (Search Console: Settings → Users and permissions; GA4: Admin → Property access management). Then they can connect it.
            </li>
          </Steps>
        </Section>

        <Section id="hand-over" title="Give the business owner their own login">
          <Steps>
            <li>
              Open the location, then <Where>Team → Invite a teammate</Where>.
            </li>
            <li>
              Enter the owner&apos;s email, choose <Where>Owner</Where>, and send. (You can only invite an Owner to a location you set up that
              has no owner yet.)
            </li>
            <li>
              Once they accept, &ldquo;No owner login yet&rdquo; disappears from your list, and they can connect Google and manage their own
              account. You keep managing it.
            </li>
          </Steps>
        </Section>

        <Section id="agency-limits" title="What agencies can and can't do">
          <ul className="list-disc pl-6">
            <li>
              <Where>Can:</Where> see every location&apos;s dashboard, keyword plan, action plan and progress; build plans; mark work done;
              invite helpers as members; invite the owner of a location you set up.
            </li>
            <li>
              <Where>Can&apos;t:</Where> manage a location&apos;s own billing, change its team&apos;s roles, make anyone an owner of a business
              that already has one, or connect or disconnect its Google accounts.
            </li>
            <li>Every business can remove your access at any time, and keeps its own data if it does.</li>
          </ul>
        </Section>

        <Section id="stop-managing" title="Stop managing a location">
          <Steps>
            <li>
              In your workspace, find the location and click <Where>More → Stop managing</Where>.
            </li>
            <li>
              If the owner has a login, they keep their account and data. If nobody else has a login, the location is locked and deleted after
              30 days.
            </li>
          </Steps>
          <p className="text-sm text-slate-600 dark:text-slate-400">Only the agency&apos;s owner can do this; staff can&apos;t.</p>
        </Section>
      </main>
    </div>
  );
}
