import { describe, expect, it } from "vitest";

import { classifyError, getErrorMessage } from "./errors";

describe("classifyError", () => {
  it("reads the retry window from rate-limit hints", () => {
    const result = classifyError({
      code: "P0429",
      message: "You're sending a lot at once. Try again in a few seconds.",
      hint: "retry_after=4",
    });
    expect(result).toMatchObject({ kind: "rate_limited", retryable: true, retryAfterMs: 4000 });
    expect(result.message).toBe("You're sending a lot at once. Try again in a few seconds.");
  });

  it("treats dropped connections as retryable", () => {
    expect(classifyError(new TypeError("Failed to fetch"))).toMatchObject({ kind: "network", retryable: true });
    expect(classifyError({ message: "TypeError: NetworkError when attempting to fetch resource." }).retryable).toBe(true);
  });

  it("never retries permission or validation failures", () => {
    expect(classifyError({ code: "42501", message: "permission denied" })).toMatchObject({ kind: "forbidden", retryable: false });
    expect(classifyError({ code: "22023", message: "One of the attachments is invalid." })).toMatchObject({ kind: "invalid", retryable: false });
    expect(classifyError({ code: "23505", message: "duplicate key value" }).kind).toBe("conflict");
  });

  it("retries server-side resource problems", () => {
    expect(classifyError({ code: "57014", message: "canceling statement due to statement timeout" }).retryable).toBe(true);
    expect(classifyError({ code: "PGRST001", message: "Could not connect" })).toMatchObject({ kind: "server", retryable: true });
  });
});

describe("getErrorMessage", () => {
  it("passes through human sentences from database functions", () => {
    expect(getErrorMessage({ message: "Pick at least one person." })).toBe("Pick at least one person.");
  });

  it("explains when Supabase refuses to email an address", () => {
    expect(getErrorMessage({ message: "Error sending confirmation email" })).toMatch(/custom SMTP/);
  });

  it("hides internals behind a fallback", () => {
    expect(getErrorMessage({ message: "relation \"x\" does not exist" }, "Nope.")).toBe("Nope.");
  });
});
