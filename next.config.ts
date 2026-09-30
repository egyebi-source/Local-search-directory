import type { NextConfig } from "next";
import { API_CSP } from "./src/server/security/csp";
import { SECURITY_HEADERS } from "./src/server/security/headers";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      { source: "/api/:path*", headers: [{ key: "Content-Security-Policy", value: API_CSP }] },
    ];
  },
};

export default nextConfig;
