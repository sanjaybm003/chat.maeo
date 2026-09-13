import type { NextRequest } from "next/server";

import { buildContentSecurityPolicy, createNonce } from "@/lib/security/csp";
import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  const nonce = createNonce();
  const policy = buildContentSecurityPolicy({
    nonce,
    supabaseUrl: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    isDev: process.env.NODE_ENV === "development",
  });

  // Next.js reads the policy from the request to stamp its own scripts.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);

  const response = await updateSession(request, requestHeaders);
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  matcher: [
    "/((?!api/|_next/static|_next/image|favicon.ico|icon.svg|sw.js|apple-icon.png|manifest.webmanifest|robots.txt|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|js|map|woff2?)$).*)",
  ],
};
