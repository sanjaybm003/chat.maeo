import "server-only";

import { headers } from "next/headers";

import { env } from "@/lib/env";
import { preferredOrigin } from "@/lib/origin";

/**
 * The origin that emailed links point back to.
 *
 * Production: the configured site URL (NEXT_PUBLIC_SITE_URL, or the Vercel
 * production domain), so links can never be steered by a spoofed Host header.
 * Development: the address the app is really being used at, whatever the
 * port. Allow `<origin>/**` in Supabase Auth redirect URLs.
 */
export async function getAppOrigin() {
  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  const protocol =
    headerList.get("x-forwarded-proto") ?? (host && /^(localhost|127\.0\.0\.1|\[::1\])(:|$)/.test(host) ? "http" : "https");
  const requestOrigin = headerList.get("origin") ?? (host ? `${protocol}://${host}` : null);

  return preferredOrigin({
    configured: env.configuredSiteUrl ?? undefined,
    requestOrigin,
    production: process.env.NODE_ENV === "production",
    fallback: env.siteUrl,
  });
}
