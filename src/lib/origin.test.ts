import { describe, expect, it } from "vitest";

import { isLocalHostname, preferredOrigin } from "./origin";

describe("preferredOrigin", () => {
  it("uses only the configured site URL in production, whatever the request says", () => {
    expect(
      preferredOrigin({ configured: "https://chat.example.com/", requestOrigin: "https://evil.example", production: true }),
    ).toBe("https://chat.example.com");
  });

  it("follows the real request in development so links match the running port", () => {
    expect(
      preferredOrigin({ configured: "http://localhost:3000", requestOrigin: "http://localhost:60846", production: false }),
    ).toBe("http://localhost:60846");
  });

  it("falls back to the site URL, then the default, when the request origin is unusable", () => {
    expect(preferredOrigin({ configured: "http://localhost:3000", requestOrigin: "not a url", production: false })).toBe(
      "http://localhost:3000",
    );
    expect(preferredOrigin({ requestOrigin: null, production: true, fallback: "https://fallback.dev" })).toBe(
      "https://fallback.dev",
    );
  });
});

describe("isLocalHostname", () => {
  it("recognises addresses that only work on this machine", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]", "app.localhost", "LOCALHOST"]) {
      expect(isLocalHostname(host)).toBe(true);
    }
  });

  it("treats real and LAN addresses as shareable", () => {
    for (const host of ["chat.example.com", "192.168.0.105", "maeosan.vercel.app"]) {
      expect(isLocalHostname(host)).toBe(false);
    }
  });
});
