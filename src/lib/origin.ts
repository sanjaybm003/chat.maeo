const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

/** Addresses that only resolve on the machine itself. */
export function isLocalHostname(hostname: string) {
  const host = hostname.toLowerCase();
  return LOCAL_HOSTNAMES.has(host) || host.endsWith(".localhost");
}

function toOrigin(value: string | null | undefined) {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

interface OriginInput {
  /** NEXT_PUBLIC_SITE_URL */
  configured?: string;
  /** Where this request actually came in. */
  requestOrigin?: string | null;
  production: boolean;
  fallback?: string;
}

/**
 * Which origin generated links should point at.
 *
 * Production trusts only the configured site URL, because a Host header can be
 * spoofed. Development follows the request, so links work on whatever port
 * the dev server really runs on instead of pointing at a stale one.
 */
export function preferredOrigin({ configured, requestOrigin, production, fallback = "http://localhost:3000" }: OriginInput) {
  const site = toOrigin(configured?.trim());
  if (production && site) return site;
  return toOrigin(requestOrigin) ?? site ?? fallback;
}
