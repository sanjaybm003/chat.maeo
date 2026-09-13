import { z } from "zod";

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
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).optional(),
});

export interface EnvReport {
  errors: string[];
  warnings: string[];
}

/**
 * Checks configuration once at server start. Missing essentials are errors;
 * missing optional capabilities (push, service role) are warnings that say
 * exactly which feature is off.
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
  if (!value.NEXT_PUBLIC_SUPABASE_ANON_KEY && !value.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    errors.push("NEXT_PUBLIC_SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) is required.");
  }
  if (!value.SUPABASE_SERVICE_ROLE_KEY && !value.SUPABASE_SECRET_KEY) {
    warnings.push("SUPABASE_SERVICE_ROLE_KEY is not set: invitation emails, web push and account deletion are disabled.");
  }
  if (!value.NEXT_PUBLIC_SITE_URL) {
    warnings.push("NEXT_PUBLIC_SITE_URL is not set: auth links will use the request origin.");
  }

  const pushKeys = [value.NEXT_PUBLIC_VAPID_PUBLIC_KEY, value.VAPID_PRIVATE_KEY, value.PUSH_DISPATCH_SECRET];
  if (pushKeys.some(Boolean) && !pushKeys.every(Boolean)) {
    warnings.push("Web push is partly configured: set NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and PUSH_DISPATCH_SECRET together.");
  }

  return { errors, warnings };
}
