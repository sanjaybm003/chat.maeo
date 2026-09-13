import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { env } from "./env";

const SITE_VARIABLES = [
  "VERCEL",
  "NEXT_PUBLIC_SITE_URL",
  "VERCEL_ENV",
  "NEXT_PUBLIC_VERCEL_ENV",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "NEXT_PUBLIC_VERCEL_PROJECT_PRODUCTION_URL",
  "VERCEL_URL",
  "NEXT_PUBLIC_VERCEL_URL",
];

beforeEach(() => {
  for (const name of SITE_VARIABLES) vi.stubEnv(name, "");
});
afterEach(() => vi.unstubAllEnvs());

describe("env.siteUrl", () => {
  it("prefers an explicit NEXT_PUBLIC_SITE_URL", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://chat.example.com/");
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "chatmaeo.vercel.app");
    expect(env.siteUrl).toBe("https://chat.example.com");
  });

  it("upgrades an http:// site URL to https:// on Vercel", () => {
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://chatmaeo.vercel.app");
    expect(env.siteUrl).toBe("https://chatmaeo.vercel.app");
  });

  it("leaves http:// alone off Vercel and for local addresses", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://192.168.0.20:3000");
    expect(env.siteUrl).toBe("http://192.168.0.20:3000");
    vi.stubEnv("VERCEL", "1");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "http://localhost:3000");
    expect(env.siteUrl).toBe("http://localhost:3000");
  });

  it("uses the Vercel production domain when the site URL is unset", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "chatmaeo.vercel.app");
    vi.stubEnv("VERCEL_URL", "chatmaeo-abc123.vercel.app");
    expect(env.siteUrl).toBe("https://chatmaeo.vercel.app");
  });

  it("uses the deployment's own URL on preview deployments", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "chatmaeo.vercel.app");
    vi.stubEnv("VERCEL_URL", "chatmaeo-git-feature.vercel.app");
    expect(env.siteUrl).toBe("https://chatmaeo-git-feature.vercel.app");
  });

  it("falls back to localhost when nothing is configured", () => {
    expect(env.configuredSiteUrl).toBeNull();
    expect(env.siteUrl).toBe("http://localhost:3000");
  });
});
