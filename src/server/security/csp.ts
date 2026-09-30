// Pure helpers (no "server-only") because proxy.ts imports them.

export function generateNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes));
}

/**
 * Strict nonce-based Content-Security-Policy for HTML pages (PRD §8.4).
 * Third-party origins (e.g. Cloudflare Turnstile in Phase 2) must be added
 * here explicitly — never loosen with 'unsafe-inline'.
 */
export function buildPageCsp(nonce: string, isDev: boolean): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'nonce-${nonce}'`,
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ];
  return directives.join("; ");
}

/** API routes return JSON only, so they get a lock-everything-down policy. */
export const API_CSP = "default-src 'none'; frame-ancestors 'none'";
