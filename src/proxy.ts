import { NextResponse, type NextRequest } from "next/server";
import { buildPageCsp, generateNonce } from "@/server/security/csp";

// Adds a fresh per-request nonce CSP to every HTML page. Next.js reads the
// nonce from the request header and attaches it to its own scripts.
export function proxy(request: NextRequest) {
  const nonce = generateNonce();
  const csp = buildPageCsp(nonce, process.env.NODE_ENV === "development");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
