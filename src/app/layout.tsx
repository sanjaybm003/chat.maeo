import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, IBM_Plex_Mono, Instrument_Sans } from "next/font/google";
import { headers } from "next/headers";
import type { ReactNode } from "react";

import { AppProviders } from "@/components/providers/app-providers";
import { InlineScript } from "@/components/providers/inline-script";
import { env } from "@/lib/env";
import { THEME_SCRIPT } from "@/lib/theme-script";

import "./globals.css";

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  axes: ["opsz"],
  variable: "--font-display-face",
  display: "swap",
});

const body = Instrument_Sans({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono-face",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(env.siteUrl),
  title: { default: "maeosan", template: "%s · maeosan" },
  description: "Team chat for startups and small companies. Your people, one tap away.",
  applicationName: "maeosan",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f0e8" },
    { media: "(prefers-color-scheme: dark)", color: "#12110e" },
  ],
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  // Set by proxy.ts for the Content Security Policy; also makes every page
  // render per request, which a nonce requires.
  const nonce = (await headers()).get("x-nonce") ?? undefined;

  return (
    <html
      lang="en"
      data-theme="light"
      suppressHydrationWarning
      className={`${display.variable} ${body.variable} ${mono.variable}`}
    >
      <head>
        <InlineScript html={THEME_SCRIPT} nonce={nonce} />
      </head>
      <body>
        <AppProviders>{children}</AppProviders>
      </body>
    </html>
  );
}
