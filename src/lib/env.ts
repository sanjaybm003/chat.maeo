import { isLocalHostname } from "@/lib/origin";

/**
 * Public runtime configuration. Values are read lazily so `next build` works
 * without secrets, but any real use without them fails loudly and clearly.
 * NEXT_PUBLIC_* must be referenced literally for Next.js to inline them.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing environment variable ${name}. Copy .env.example to .env.local and fill it in.`,
    );
  }
  return value;
}

function stripTrailingSlash(url: string) {
  return url.replace(/\/+$/, "");
}

/**
 * Vercel serves every deployment over HTTPS. An http:// site URL there would
 * put links on an address that Supabase's redirect allow-list doesn't match.
 */
function normalizeSiteUrl(raw: string) {
  const url = stripTrailingSlash(raw.trim());
  if (!process.env.VERCEL || !url.startsWith("http://")) return url;
  try {
    return isLocalHostname(new URL(url).hostname) ? url : `https://${url.slice("http://".length)}`;
  } catch {
    return url;
  }
}

/**
 * The public address of this deployment. An explicit NEXT_PUBLIC_SITE_URL
 * wins; on Vercel, when it's unset, the project's production domain (or a
 * preview deployment's own URL) is used, so nothing has to be kept in sync.
 */
function configuredSiteUrl(): string | null {
  if (process.env.NEXT_PUBLIC_SITE_URL) return normalizeSiteUrl(process.env.NEXT_PUBLIC_SITE_URL);

  const vercelEnv = process.env.VERCEL_ENV || process.env.NEXT_PUBLIC_VERCEL_ENV;
  const productionHost = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL;
  const deploymentHost = process.env.VERCEL_URL || process.env.NEXT_PUBLIC_VERCEL_URL;

  if (vercelEnv === "production" && productionHost) return `https://${productionHost}`;
  if (deploymentHost) return `https://${deploymentHost}`;
  return null;
}

export const env = {
  get supabaseUrl() {
    return required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
  },
  get supabaseAnonKey() {
    return required(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    );
  },
  /** Null when nothing says where the site lives (local development). */
  get configuredSiteUrl() {
    return configuredSiteUrl();
  },
  get siteUrl() {
    return configuredSiteUrl() ?? "http://localhost:3000";
  },
  get googleAuthEnabled() {
    return process.env.NEXT_PUBLIC_AUTH_GOOGLE_ENABLED === "true";
  },
};
