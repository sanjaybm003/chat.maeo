import "server-only";

import { headers } from "next/headers";

import { env } from "@/lib/env";

/**
 * The origin auth emails should link back to. An explicit NEXT_PUBLIC_SITE_URL
 * always wins, so links can never be steered by a spoofed Host header in
 * production. Remember to allow `<origin>/**` in Supabase Auth redirect URLs.
 */
export async function getAppOrigin() {
  if (process.env.NEXT_PUBLIC_SITE_URL) return env.siteUrl;

  const headerList = await headers();
  const origin = headerList.get("origin");
  if (origin) return origin;

  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  if (host) {
    const protocol = headerList.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
    return `${protocol}://${host}`;
  }
  return env.siteUrl;
}
