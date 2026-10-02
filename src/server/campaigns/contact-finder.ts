import "server-only";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

// Finds an email address a business publishes on its own website (homepage,
// then its contact page). Google listings don't carry emails, so this is the
// only source. We only read pages on the business's own domain, over the
// public internet, small and fast; never anything else.

const MAX_BYTES = 400_000;
const TIMEOUT_MS = 6_000;
const MAX_REDIRECTS = 3;

/** Private, loopback, link-local and other non-public addresses: never fetched. */
export function isPublicAddress(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // carrier-grade NAT
    if (a === 169 && b === 254) return false; // link-local / cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    return true;
  }
  if (v === 6) {
    const x = ip.toLowerCase();
    if (x === "::" || x === "::1") return false;
    if (/^f[cd]/.test(x) || /^fe[89ab]/.test(x) || /^ff/.test(x)) return false;
    const mapped = x.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicAddress(mapped[1]);
    return true;
  }
  return false;
}

const onDomain = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);

/** GET a page on the business's own domain; null for anything off-domain, private, huge, slow or not HTML. */
export async function fetchOwnPage(url: string, domain: string): Promise<{ url: string; html: string } | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let u: URL;
    try {
      u = new URL(current);
    } catch {
      return null;
    }
    if (!/^https?:$/.test(u.protocol) || u.username || u.password || (u.port && !["80", "443"].includes(u.port))) return null;
    const host = u.hostname.toLowerCase();
    if (!onDomain(host, domain) || isIP(host)) return null;
    try {
      const addrs = await lookup(host, { all: true });
      if (!addrs.length || !addrs.every((a) => isPublicAddress(a.address))) return null;
    } catch {
      return null;
    }
    let res: Response;
    try {
      res = await fetch(u, {
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { "User-Agent": "TorqueRankBot/1.0 (+https://www.torquerank.com)", Accept: "text/html" },
      });
    } catch {
      return null;
    }
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("location");
      if (!next) return null;
      current = new URL(next, u).toString();
      continue;
    }
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("text/html") || !res.body) return null;
    // Read at most MAX_BYTES.
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    while (size < MAX_BYTES) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
    }
    await reader.cancel().catch(() => {});
    return { url: u.toString(), html: new TextDecoder().decode(Buffer.concat(chunks)).slice(0, MAX_BYTES) };
  }
  return null;
}

const EMAIL = /[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,190}\.[a-z]{2,24}/gi;
const JUNK = /\.(png|jpe?g|gif|svg|webp|css|js)$|@(example|domain|email|yourdomain|sentry|wixpress|sentry-next)\.|^(no-?reply|donotreply)@/i;

/** Emails in a page, the business's own domain first. */
export function emailsIn(html: string, domain: string): string[] {
  const decoded = html.replace(/&#64;|&#x40;|\[at\]|\(at\)/gi, "@").replace(/&#46;|\[dot\]|\(dot\)/gi, ".");
  const found = [...new Set((decoded.match(EMAIL) ?? []).map((e) => e.toLowerCase().replace(/^mailto:/, "")))].filter((e) => !JUNK.test(e));
  const own = found.filter((e) => onDomain(e.split("@")[1], domain));
  return [...own, ...found.filter((e) => !own.includes(e))].slice(0, 5);
}

/** Links to a contact page on the same site. */
export function contactLinks(html: string, base: string, domain: string): string[] {
  const out: string[] = [];
  for (const m of html.matchAll(/href\s*=\s*["']([^"'#]+)["']/gi)) {
    const href = m[1];
    if (!/contact|about|reach|location/i.test(href)) continue;
    try {
      const u = new URL(href, base);
      if (/^https?:$/.test(u.protocol) && onDomain(u.hostname.toLowerCase(), domain)) out.push(u.toString());
    } catch {
      // ignore malformed links
    }
  }
  return [...new Set(out)].sort((a, b) => Number(!/contact/i.test(a)) - Number(!/contact/i.test(b))).slice(0, 2);
}

/** An email the business publishes on its website, and the page it was found on. */
export async function findPublishedEmail(domain: string): Promise<{ email: string; source: string } | null> {
  const home = (await fetchOwnPage(`https://${domain}/`, domain)) ?? (await fetchOwnPage(`https://www.${domain}/`, domain));
  if (!home) return null;
  const onHome = emailsIn(home.html, domain);
  if (onHome.length) return { email: onHome[0], source: home.url };
  for (const link of contactLinks(home.html, home.url, domain)) {
    const page = await fetchOwnPage(link, domain);
    const emails = page ? emailsIn(page.html, domain) : [];
    if (page && emails.length) return { email: emails[0], source: page.url };
  }
  return null;
}
