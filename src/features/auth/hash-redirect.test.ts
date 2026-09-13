import { describe, expect, it } from "vitest";

import { authHashRedirect } from "./hash-redirect";

const at = (pathname: string, search = "", hash = "") => ({ pathname, search, hash });

describe("authHashRedirect", () => {
  it("finishes sign-in when Supabase drops invite tokens on the home page", () => {
    expect(authHashRedirect(at("/", "", "#access_token=a&refresh_token=b&type=invite"))).toBe(
      "/auth/session?next=%2F#access_token=a&refresh_token=b&type=invite",
    );
  });

  it("keeps a safe next path from the landing page", () => {
    expect(authHashRedirect(at("/login", "?next=%2Finvite%2Fabc", "#access_token=a"))).toBe(
      "/auth/session?next=%2Finvite%2Fabc#access_token=a",
    );
    expect(authHashRedirect(at("/login", "?next=https%3A%2F%2Fevil.example", "#access_token=a"))).toBe(
      "/auth/session?next=%2F#access_token=a",
    );
  });

  it("routes link errors through the same page so they get a clear message", () => {
    expect(authHashRedirect(at("/", "", "#error=access_denied&error_code=otp_expired"))).toBe(
      "/auth/session?next=%2F#error=access_denied&error_code=otp_expired",
    );
  });

  it("ignores ordinary fragments and the session page itself", () => {
    expect(authHashRedirect(at("/w/acme", "", "#section"))).toBeNull();
    expect(authHashRedirect(at("/", "", ""))).toBeNull();
    expect(authHashRedirect(at("/auth/session", "", "#access_token=a"))).toBeNull();
  });
});
