import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { env } from "@/lib/env";
import { isGuestOnlyPath, isPublicPath, routes } from "@/lib/routes";
import type { Database } from "@/types/database";

/**
 * Refreshes the auth session on every navigation and keeps signed-out
 * visitors on public pages. Workspace and onboarding checks need the database,
 * so they live in the route layouts rather than here.
 */
export async function updateSession(request: NextRequest, requestHeaders: Headers = new Headers(request.headers)) {
  const next = () => NextResponse.next({ request: { headers: requestHeaders } });
  let response = next();

  const supabase = createServerClient<Database>(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        // Server components rendering this request must see the refreshed tokens.
        requestHeaders.set("cookie", request.headers.get("cookie") ?? "");
        response = next();
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        for (const [key, value] of Object.entries(headers)) {
          response.headers.set(key, value);
        }
      },
    },
  });

  // Do not run code between creating the client and getClaims(): it is what
  // refreshes an expired session.
  const { data } = await supabase.auth.getClaims();
  const signedIn = Boolean(data?.claims?.sub);
  const { pathname, search } = request.nextUrl;

  if (!signedIn && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = routes.login;
    url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    return withCookies(NextResponse.redirect(url), response);
  }

  if (signedIn && isGuestOnlyPath(pathname)) {
    const url = request.nextUrl.clone();
    const target = request.nextUrl.searchParams.get("next");
    url.pathname = target && target.startsWith("/") && !target.startsWith("//") ? target : routes.home;
    url.search = "";
    return withCookies(NextResponse.redirect(url), response);
  }

  return response;
}

function withCookies(target: NextResponse, source: NextResponse) {
  for (const cookie of source.cookies.getAll()) {
    target.cookies.set(cookie);
  }
  const cacheControl = source.headers.get("cache-control");
  if (cacheControl) target.headers.set("cache-control", cacheControl);
  return target;
}
