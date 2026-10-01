/**
 * Normalize user input like "https://www.Example.com/contact" to
 * "example.com". Returns null when it isn't a plausible public hostname.
 */
export function normalizeDomain(input: string): string | null {
  let value = input.trim().toLowerCase();
  if (!value) return null;
  if (!/^[a-z]+:\/\//.test(value)) value = `https://${value}`;
  let host: string;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password || url.port) return null;
    host = url.hostname;
  } catch {
    return null;
  }
  host = host.replace(/^www\./, "").replace(/\.$/, "");
  if (host.length > 253) return null;
  const labels = host.split(".");
  if (labels.length < 2) return null;
  const labelOk = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
  if (!labels.every((l) => labelOk.test(l))) return null;
  if (!/^[a-z]{2,63}$/.test(labels.at(-1)!)) return null; // no IPs, no numeric TLDs
  return host;
}
