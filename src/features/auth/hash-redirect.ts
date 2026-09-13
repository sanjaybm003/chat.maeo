import { routes, safeNextPath } from "@/lib/routes";

const AUTH_FRAGMENT = /(^#|&)(access_token|error_code)=/;

/**
 * Supabase finishes some email links (invites) by putting tokens in the URL
 * fragment. When the return address isn't on its allow-list, it drops them on
 * its Site URL instead of /auth/callback, so any page can receive them.
 *
 * Returns where to send the browser to finish signing in, or null.
 */
export function authHashRedirect(location: Pick<Location, "pathname" | "search" | "hash">): string | null {
  if (location.pathname === routes.authSession || !AUTH_FRAGMENT.test(location.hash)) return null;
  const next = safeNextPath(new URLSearchParams(location.search).get("next"));
  return `${routes.authSession}?next=${encodeURIComponent(next)}${location.hash}`;
}
