import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans, Newsreader } from "next/font/google";
import { connection } from "next/server";
import "./globals.css";

// Body: IBM Plex Sans (plain, a little industrial). Headlines: Newsreader
// (a newspaper serif). Both are self-hosted by next/font; no third-party requests.
const bodyFont = IBM_Plex_Sans({ variable: "--font-body", subsets: ["latin"], weight: ["400", "500", "600", "700"] });
const displayFont = Newsreader({ variable: "--font-headline", subsets: ["latin"], weight: ["500", "600"], style: ["normal", "italic"] });
const monoFont = IBM_Plex_Mono({ variable: "--font-code", subsets: ["latin"], weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "TorqueRank",
  description: "See whether your online presence produces clicks, visits and leads — and what to fix this week.",
};

export default async function RootLayout({ children }: LayoutProps<"/">) {
  // Render per request so every page gets the fresh CSP nonce from proxy.ts.
  await connection();

  return (
    <html
      lang="en"
      className={`${bodyFont.variable} ${displayFont.variable} ${monoFont.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
