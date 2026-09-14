import { describe, expect, it } from "vitest";

import { validateEnv } from "@/lib/config/validate-env";

import { buildContentSecurityPolicy, createNonce } from "./csp";

describe("buildContentSecurityPolicy", () => {
  it("allows only nonce'd scripts and the Supabase project in production", () => {
    const policy = buildContentSecurityPolicy({ nonce: "abc", supabaseUrl: "https://ref.supabase.co", isDev: false });
    expect(policy).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(policy).not.toContain("unsafe-eval");
    expect(policy).toContain("connect-src 'self' https://ref.supabase.co wss://ref.supabase.co");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy.endsWith("upgrade-insecure-requests")).toBe(true);
  });

  it("relaxes only what local development needs", () => {
    const policy = buildContentSecurityPolicy({ nonce: "n", supabaseUrl: "http://127.0.0.1:54321", isDev: true });
    expect(policy).toContain("'unsafe-eval'");
    expect(policy).toContain("ws://127.0.0.1:54321");
    expect(policy).not.toContain("upgrade-insecure-requests");
  });

  it("generates unique nonces", () => {
    expect(createNonce()).not.toBe(createNonce());
  });
});

describe("validateEnv", () => {
  const base = {
    NEXT_PUBLIC_SUPABASE_URL: "https://ref.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "a".repeat(40),
    SUPABASE_SERVICE_ROLE_KEY: "s".repeat(40),
    NEXT_PUBLIC_SITE_URL: "https://chat.example.com",
  };

  it("accepts a complete configuration", () => {
    expect(validateEnv(base)).toEqual({ errors: [], warnings: [] });
  });

  it("reports missing essentials as errors and missing capabilities as warnings", () => {
    const report = validateEnv({ NEXT_PUBLIC_SUPABASE_URL: "https://ref.supabase.co" });
    expect(report.errors.join(" ")).toMatch(/ANON_KEY/);
    expect(report.warnings.join(" ")).toMatch(/SERVICE_ROLE_KEY/);
  });

  it("warns when the site URL doesn't match the Vercel production domain", () => {
    const report = validateEnv({
      ...base,
      NEXT_PUBLIC_SITE_URL: "http://chat.maeo.vercel.app",
      VERCEL_ENV: "production",
      VERCEL_PROJECT_PRODUCTION_URL: "chatmaeo.vercel.app",
      NODE_ENV: "production",
    });
    const warnings = report.warnings.join(" ");
    expect(warnings).toMatch(/production domain is chatmaeo\.vercel\.app/);
    expect(warnings).toMatch(/Use https:\/\/chat\.maeo\.vercel\.app/);
  });

  it("doesn't nag on Vercel when the site URL is left to the production domain", () => {
    const report = validateEnv({
      ...base,
      NEXT_PUBLIC_SITE_URL: undefined,
      VERCEL_ENV: "production",
      VERCEL_PROJECT_PRODUCTION_URL: "chatmaeo.vercel.app",
    });
    expect(report.warnings.join(" ")).not.toMatch(/NEXT_PUBLIC_SITE_URL/);
  });

  it("warns when Resend can only reach the account owner", () => {
    const report = validateEnv({ ...base, RESEND_API_KEY: "re_test_key" });
    expect(report.warnings.join(" ")).toMatch(/verified in Resend/);
  });

  it("flags half-configured web push", () => {
    const report = validateEnv({ ...base, VAPID_PRIVATE_KEY: "p".repeat(40) });
    expect(report.warnings.join(" ")).toMatch(/Web push is partly configured/);
  });

  it("checks Claude-on-Bedrock settings with warnings, never blocking startup", () => {
    expect(validateEnv({ ...base, BEDROCK_API_KEY: "k".repeat(40), BEDROCK_REGION: "eu-west-1" })).toEqual({ errors: [], warnings: [] });

    const report = validateEnv({ ...base, BEDROCK_REGION: "virginia", CLAUDE_HOST: "bedrock", BEDROCK_ENDPOINT: "fastest" });
    expect(report.errors).toEqual([]);
    const warnings = report.warnings.join(" ");
    expect(warnings).toMatch(/isn't an AWS region/);
    expect(warnings).toMatch(/no Bedrock API key is set/);
    expect(warnings).toMatch(/BEDROCK_ENDPOINT must be mantle or runtime/);
  });

  it("warns before a short-term Bedrock key stops working", () => {
    const key = (date: string) =>
      `bedrock-api-key-${btoa(
        `bedrock.amazonaws.com/?Action=CallWithBearerToken&X-Amz-Credential=ASIAEXAMPLE%2F${date.slice(0, 8)}%2Fus-east-1%2Fbedrock%2Faws4_request&X-Amz-Date=${date}&X-Amz-Expires=43200&Version=1`,
      )}`;

    expect(validateEnv({ ...base, ANTHROPIC_API_KEY: key("20990101T000000Z") }).warnings.join(" ")).toMatch(
      /short-term key that expires at 2099-01-01T12:00Z/,
    );
    expect(validateEnv({ ...base, BEDROCK_API_KEY: key("20200101T000000Z") }).warnings.join(" ")).toMatch(/short-term key that expired at/);
    expect(validateEnv({ ...base, BEDROCK_API_KEY: key("20990101T000000Z"), BEDROCK_REGION: "eu-west-1" }).warnings.join(" ")).toMatch(
      /issued for us-east-1 but BEDROCK_REGION is eu-west-1/,
    );
  });
});
