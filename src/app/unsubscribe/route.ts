import { unsubscribe, verifyUnsubscribe } from "@/server/digest/digest";

export const dynamic = "force-dynamic";

// Stop weekly emails. GET shows a button (so link scanners can't
// unsubscribe people by just fetching the link); POST does it, which also
// serves mail apps' one-click unsubscribe (RFC 8058). Links are HMAC-signed.

const page = (body: string, status = 200) =>
  new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>TorqueRank emails</title></head><body><main>${body}</main></body></html>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } },
  );

function params(url: string) {
  const u = new URL(url);
  return { userId: u.searchParams.get("u") ?? "", sig: u.searchParams.get("s") ?? "" };
}

export async function GET(request: Request) {
  const { userId, sig } = params(request.url);
  if (!verifyUnsubscribe(userId, sig)) return page("<h1>This link isn't valid.</h1>", 400);
  const action = `/unsubscribe?u=${encodeURIComponent(userId)}&amp;s=${encodeURIComponent(sig)}`;
  return page(`<h1>Stop weekly TorqueRank emails?</h1><form method="post" action="${action}"><button type="submit">Yes, stop them</button></form>`);
}

export async function POST(request: Request) {
  const { userId, sig } = params(request.url);
  if (!verifyUnsubscribe(userId, sig)) return page("<h1>This link isn't valid.</h1>", 400);
  await unsubscribe(userId);
  return page("<h1>Done. You won't get weekly emails anymore.</h1><p>Your dashboard still updates every day.</p>");
}
