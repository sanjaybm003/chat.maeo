import { z } from "zod";

import { isLocalHostname } from "@/lib/origin";

const url = z.url({ protocol: /^https?$/ });

const schema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: url,
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(20).optional(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20).optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
  SUPABASE_SECRET_KEY: z.string().min(20).optional(),
  NEXT_PUBLIC_SITE_URL: url.optional(),
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: z.string().min(40).optional(),
  VAPID_PRIVATE_KEY: z.string().min(20).optional(),
  VAPID_SUBJECT: z.string().regex(/^(mailto:|https:\/\/)/, "Use mailto:you@domain or an https URL").optional(),
  PUSH_DISPATCH_SECRET: z.string().min(32, "Use at least 32 random characters").optional(),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).optional(),
});

export interface EnvReport {
  errors: string[];
  warnings: string[];
}

/**
 * Checks configuration once at server start. Missing essentials are errors;
 * missing or suspicious optional settings are warnings that say exactly which
 * feature is affected and how to fix it.
 */
export function validateEnv(env: Record<string, string | undefined> = process.env): EnvReport {
  const errors: string[] = [];
  const warnings: string[] = [];

  const blanksRemoved = Object.fromEntries(Object.entries(env).filter(([, value]) => value !== ""));
  const parsed = schema.safeParse(blanksRemoved);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) errors.push(`${issue.path.join(".")}: ${issue.message}`);
    return { errors, warnings };
  }

  const value = parsed.data;
  const onVercel = Boolean(env.VERCEL_ENV);
  const production = env.NODE_ENV === "production";

  if (!value.NEXT_PUBLIC_SUPABASE_ANON_KEY && !value.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    errors.push("NEXT_PUBLIC_SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) is required.");
  }
  if (!value.SUPABASE_SERVICE_ROLE_KEY && !value.SUPABASE_SECRET_KEY) {
    warnings.push("SUPABASE_SERVICE_ROLE_KEY is not set: invitation emails through Supabase, web push and account deletion are disabled.");
  }

  if (value.NEXT_PUBLIC_SITE_URL) {
    const site = new URL(value.NEXT_PUBLIC_SITE_URL);
    const productionHost = env.VERCEL_PROJECT_PRODUCTION_URL;
    if (env.VERCEL_ENV === "production" && productionHost && site.host !== productionHost) {
      warnings.push(
        `NEXT_PUBLIC_SITE_URL points to ${site.host}, but this project's production domain is ${productionHost}. ` +
          "Sign-in and invitation links will open the wrong site. Correct it in Vercel and redeploy, or remove it to use the production domain automatically.",
      );
    }
    if (production && site.protocol === "http:" && !isLocalHostname(site.hostname)) {
      warnings.push(`NEXT_PUBLIC_SITE_URL uses http://. Use https://${site.host} so links aren't downgraded or blocked.`);
    }
  } else if (!onVercel) {
    warnings.push("NEXT_PUBLIC_SITE_URL is not set: auth links will use the request origin.");
  }

  if (value.RESEND_API_KEY && (!value.EMAIL_FROM || /@resend\.dev\b/i.test(value.EMAIL_FROM))) {
    warnings.push(
      "RESEND_API_KEY is set but EMAIL_FROM isn't on a domain you verified in Resend, so Resend will only deliver to your own account email.",
    );
  }

  const pushKeys = [value.NEXT_PUBLIC_VAPID_PUBLIC_KEY, value.VAPID_PRIVATE_KEY, value.PUSH_DISPATCH_SECRET];
  if (pushKeys.some(Boolean) && !pushKeys.every(Boolean)) {
    warnings.push("Web push is partly configured: set NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and PUSH_DISPATCH_SECRET together.");
  }

  return { errors, warnings };
}
