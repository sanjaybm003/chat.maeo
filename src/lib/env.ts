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
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

export const env = {
  get supabaseUrl() {
    return required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
  },
  get supabaseAnonKey() {
    return required(
      "NEXT_PUBLIC_SUPABASE_ANON_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    );
  },
  get siteUrl() {
    if (process.env.NEXT_PUBLIC_SITE_URL) {
      return stripTrailingSlash(process.env.NEXT_PUBLIC_SITE_URL);
    }
    if (process.env.NEXT_PUBLIC_VERCEL_URL) {
      return `https://${process.env.NEXT_PUBLIC_VERCEL_URL}`;
    }
    return "http://localhost:3000";
  },
  get googleAuthEnabled() {
    return process.env.NEXT_PUBLIC_AUTH_GOOGLE_ENABLED === "true";
  },
};
