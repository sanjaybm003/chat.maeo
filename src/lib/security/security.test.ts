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

  it("flags half-configured web push", () => {
    const report = validateEnv({ ...base, VAPID_PRIVATE_KEY: "p".repeat(40) });
    expect(report.warnings.join(" ")).toMatch(/Web push is partly configured/);
  });
});
