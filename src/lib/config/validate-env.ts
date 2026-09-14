import { z } from "zod";

import { describeBedrockKey, isAwsRegion, readClaudeSettings } from "@/features/ai/claude-hosts";
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

  // Claude on Amazon Bedrock. Warnings only: a typo here should switch agents off, not the whole app.
  const claude = readClaudeSettings(blanksRemoved);
  const bedrockRegion = blanksRemoved.BEDROCK_REGION;
  const claudeHost = blanksRemoved.CLAUDE_HOST;
  const bedrockEndpoint = blanksRemoved.BEDROCK_ENDPOINT;
  if (bedrockRegion && !isAwsRegion(bedrockRegion)) {
    warnings.push(`BEDROCK_REGION "${bedrockRegion}" isn't an AWS region. Use one such as us-east-1.`);
  }
  if (claudeHost && claudeHost !== "anthropic" && claudeHost !== "bedrock") {
    warnings.push("CLAUDE_HOST must be anthropic or bedrock.");
  } else if (claudeHost === "bedrock" && !claude.bedrockKey) {
    warnings.push("CLAUDE_HOST is bedrock but no Bedrock API key is set, so Claude models run through Anthropic or are unavailable.");
  } else if (claudeHost === "anthropic" && !claude.anthropicKey) {
    warnings.push("CLAUDE_HOST is anthropic but no Anthropic API key is set.");
  }

  const shortTermKey = claude.bedrockKey ? describeBedrockKey(claude.bedrockKey) : null;
  if (shortTermKey?.expiresAt) {
    const expired = shortTermKey.expiresAt.getTime() <= Date.now();
    const when = shortTermKey.expiresAt.toISOString().replace(/:\d{2}\.\d{3}Z$/, "Z");
    warnings.push(
      `The Amazon Bedrock API key is a short-term key that ${expired ? "expired" : "expires"} at ${when}. ` +
        "Agents stop replying once it expires; use a long-term Bedrock API key on a server.",
    );
  }
  if (shortTermKey?.region && bedrockRegion && isAwsRegion(bedrockRegion) && shortTermKey.region !== bedrockRegion) {
    warnings.push(
      `The Bedrock API key was issued for ${shortTermKey.region} but BEDROCK_REGION is ${bedrockRegion}. Short-term keys only work in their own region.`,
    );
  }
  if (bedrockEndpoint && bedrockEndpoint !== "mantle" && bedrockEndpoint !== "runtime") {
    warnings.push("BEDROCK_ENDPOINT must be mantle or runtime; leave it unset to pick automatically.");
  }

  return { errors, warnings };
}
