import { describe, expect, it, vi } from "vitest";

import { AgentRunError, describeFailure, friendlyRunError } from "./errors";
import { ProviderError } from "./providers/types";

vi.mock("server-only", () => ({}));

describe("describeFailure", () => {
  it("keeps the provider's reason and adds nothing for errors already written for people", () => {
    expect(describeFailure(new ProviderError("auth", "anthropic", "AI isn’t available right now.", "403 not available for this account"))).toBe(
      "403 not available for this account",
    );
    expect(describeFailure(new ProviderError("not_configured", "anthropic", "AI isn’t available right now."))).toBeNull();
    expect(describeFailure(new AgentRunError("You’re out of AI credits.", "out_of_credits"))).toBeNull();
  });

  it("describes database errors, which aren't Error instances", () => {
    const failure = { code: "42501", message: "permission denied for table ai_runs", details: null, hint: null };
    expect(describeFailure(failure)).toBe("42501 · permission denied for table ai_runs");
    expect(friendlyRunError(failure)).toBe("Something went wrong while replying. Try again.");
  });

  it("describes ordinary errors, strings and anything else it can", () => {
    expect(describeFailure(new TypeError("fetch failed"))).toBe("fetch failed");
    expect(describeFailure("timed out")).toBe("timed out");
    expect(describeFailure({ status: 500 })).toBe('{"status":500}');
    expect(describeFailure(undefined)).toBeNull();
  });
});
