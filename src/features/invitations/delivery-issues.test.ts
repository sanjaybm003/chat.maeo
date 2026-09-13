import { describe, expect, it } from "vitest";

import { classifyDeliveryFailure, mostActionableIssue } from "./delivery-issues";

describe("classifyDeliveryFailure", () => {
  it("recognises Supabase Auth email errors", () => {
    expect(classifyDeliveryFailure("over_email_send_rate_limit email rate limit exceeded", 429)).toBe("rate_limited");
    expect(classifyDeliveryFailure('email_address_not_authorized Email address "a@b.com" cannot be used as it is not authorized', 400)).toBe(
      "rejected",
    );
    expect(classifyDeliveryFailure("Missing environment variable SUPABASE_SERVICE_ROLE_KEY.")).toBe("not_configured");
  });

  it("recognises Resend errors", () => {
    expect(classifyDeliveryFailure("You can only send testing emails to your own email address.", 403)).toBe("rejected");
    expect(classifyDeliveryFailure("The example.com domain is not verified.", 422)).toBe("rejected");
    expect(classifyDeliveryFailure("API key is invalid", 401)).toBe("not_configured");
  });

  it("falls back to a generic failure", () => {
    expect(classifyDeliveryFailure("socket hang up")).toBe("failed");
  });
});

describe("mostActionableIssue", () => {
  it("prefers configuration problems over transient ones", () => {
    expect(mostActionableIssue(["failed", "rate_limited", "not_configured"])).toBe("not_configured");
    expect(mostActionableIssue(["failed", "rate_limited"])).toBe("rate_limited");
    expect(mostActionableIssue([])).toBeNull();
  });
});
