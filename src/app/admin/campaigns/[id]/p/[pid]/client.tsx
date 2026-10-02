"use client";

import { useActionState, useState } from "react";
import { analyzeAction, contactedAction, draftAction, type AnalyzeState, type DraftState } from "./actions";

const btn = "rounded-lg px-4 py-2 text-sm font-semibold";
const primary = `${btn} bg-rose-700 text-white hover:bg-rose-800 disabled:opacity-50`;
const outline = `${btn} ring-1 ring-slate-300 hover:bg-slate-50 disabled:opacity-50`;

function Hidden({ campaignId, prospectId }: { campaignId: string; prospectId: string }) {
  return (
    <>
      <input type="hidden" name="campaignId" value={campaignId} />
      <input type="hidden" name="prospectId" value={prospectId} />
    </>
  );
}

export function AnalyzeButton({ campaignId, prospectId, again }: { campaignId: string; prospectId: string; again: boolean }) {
  const [state, action, pending] = useActionState<AnalyzeState, FormData>(analyzeAction, {});
  return (
    <form action={action} className="flex flex-wrap items-center gap-3">
      <Hidden campaignId={campaignId} prospectId={prospectId} />
      <button type="submit" disabled={pending} className={again ? outline : primary}>
        {pending ? "Checking their website…" : again ? "Run the check again" : "Run the deeper check (about 2¢)"}
      </button>
      {state.error ? <span className="text-sm text-red-700">{state.error}</span> : null}
    </form>
  );
}

export function ContactedButtons({ campaignId, prospectId }: { campaignId: string; prospectId: string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {(["phone", "visit", "mail", "email"] as const).map((c) => (
        <form key={c} action={contactedAction}>
          <Hidden campaignId={campaignId} prospectId={prospectId} />
          <input type="hidden" name="channel" value={c} />
          <button type="submit" className={outline}>
            {{ phone: "Called", visit: "Visited", mail: "Mailed a letter", email: "Emailed" }[c]}
          </button>
        </form>
      ))}
    </div>
  );
}

type Sender = { name: string; phone: string; address: string };
const SENDER_KEY = "tr-outreach-sender";

function readSender(): Sender {
  try {
    const v = JSON.parse(localStorage.getItem(SENDER_KEY) ?? "{}");
    return { name: String(v.name ?? ""), phone: String(v.phone ?? ""), address: String(v.address ?? "") };
  } catch {
    return { name: "", phone: "", address: "" };
  }
}

function fill(text: string, s: Sender) {
  return text
    .replaceAll("[Your name]", s.name || "[Your name]")
    .replaceAll("[your name]", s.name || "[your name]")
    .replaceAll("[your phone]", s.phone || "[your phone]")
    .replaceAll("[Your mailing address]", s.address || "[Your mailing address]");
}

export function EmailComposer({ campaignId, prospectId, to }: { campaignId: string; prospectId: string; to: string | null }) {
  const [state, action, pending] = useActionState<DraftState, FormData>(draftAction, {});
  if (state.body && state.link) {
    // Mounted only in the browser, after the draft arrives.
    return <DraftEditor key={state.link} campaignId={campaignId} prospectId={prospectId} to={to} draft={{ link: state.link, subject: state.subject ?? "", body: state.body }} />;
  }
  return (
    <form action={action}>
      <Hidden campaignId={campaignId} prospectId={prospectId} />
      <button type="submit" disabled={pending} className={primary}>
        {pending ? "Preparing…" : "Write the email (creates their private link)"}
      </button>
      {state.error ? <p className="mt-2 text-sm text-red-700">{state.error}</p> : null}
    </form>
  );
}

function DraftEditor({
  campaignId,
  prospectId,
  to,
  draft,
}: {
  campaignId: string;
  prospectId: string;
  to: string | null;
  draft: { link: string; subject: string; body: string };
}) {
  const [sender, setSender] = useState<Sender>(readSender);
  const [recipient, setRecipient] = useState(to ?? "");
  const [subject, setSubject] = useState(draft.subject);
  const [body, setBody] = useState(() => fill(draft.body, readSender()));

  function saveSender(next: Sender) {
    setSender(next);
    try {
      localStorage.setItem(SENDER_KEY, JSON.stringify(next));
    } catch {
      // private window: the details just won't be remembered
    }
    setBody((b) => fill(b, next));
  }

  const unfilled = /\[[^\]]+\]/.test(body);
  const validTo = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(recipient);
  const href = `mailto:${encodeURIComponent(recipient)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-2 sm:grid-cols-3">
        {(["name", "phone", "address"] as const).map((k) => (
          <label key={k} className="flex flex-col gap-1 text-xs text-slate-600">
            {{ name: "Your name", phone: "Your phone", address: "Your mailing address (required by law)" }[k]}
            <input
              className="h-9 rounded-md border border-slate-300 px-2 text-sm text-slate-900"
              value={sender[k]}
              onChange={(e) => saveSender({ ...sender, [k]: e.target.value })}
            />
          </label>
        ))}
      </div>
      <label className="flex flex-col gap-1 text-xs text-slate-600">
        To
        <input className="h-9 rounded-md border border-slate-300 px-2 text-sm text-slate-900" value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder="owner@theirshop.ca" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-600">
        Subject
        <input className="h-9 rounded-md border border-slate-300 px-2 text-sm text-slate-900" value={subject} onChange={(e) => setSubject(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-600">
        Message (edit freely)
        <textarea className="min-h-72 rounded-md border border-slate-300 p-2 font-mono text-sm text-slate-900" value={body} onChange={(e) => setBody(e.target.value)} />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <a
          href={unfilled || !validTo ? undefined : href}
          aria-disabled={unfilled || !validTo}
          onClick={() => {
            if (unfilled || !validTo) return;
            const f = new FormData();
            f.set("campaignId", campaignId);
            f.set("prospectId", prospectId);
            f.set("channel", "email");
            void contactedAction(f);
          }}
          className={`${primary} ${unfilled || !validTo ? "pointer-events-none opacity-50" : ""}`}
        >
          Open in my email app
        </a>
        <button type="button" className={outline} onClick={() => void navigator.clipboard?.writeText(`${subject}\n\n${body}`)}>
          Copy
        </button>
        {unfilled ? <span className="text-sm text-red-700">Fill in everything in [square brackets] first.</span> : null}
        {!validTo ? <span className="text-sm text-slate-600">Add the owner&apos;s email address.</span> : null}
      </div>
      <p className="text-xs text-slate-500">Private link (any earlier link for this business no longer works): {draft.link}</p>
    </div>
  );
}

export function CopyText({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={outline}
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setDone(true);
      }}
    >
      {done ? "Copied" : label}
    </button>
  );
}
