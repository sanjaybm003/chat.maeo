/** Why an invitation email didn't go out. Shared by server delivery and the report UI. */
export type DeliveryIssue = "not_configured" | "rate_limited" | "rejected" | "failed";

/**
 * Maps provider errors (Supabase Auth, Resend) onto something a person can act on.
 * `detail` is the provider's code and message; `status` its HTTP status when known.
 */
export function classifyDeliveryFailure(detail: string, status?: number): DeliveryIssue {
  if (status === 429 || /rate.?limit|too many requests/i.test(detail)) return "rate_limited";
  if (
    status === 403 ||
    /not authorized|not_authorized|domain is not verified|verify a domain|testing emails|not allowed to send/i.test(detail)
  ) {
    return "rejected";
  }
  if (status === 401 || /missing environment variable|api key is invalid|invalid api key|not configured/i.test(detail)) {
    return "not_configured";
  }
  return "failed";
}

const PRIORITY: DeliveryIssue[] = ["not_configured", "rejected", "rate_limited", "failed"];

/** When invites fail for different reasons, surface the one that needs fixing first. */
export function mostActionableIssue(issues: DeliveryIssue[]): DeliveryIssue | null {
  return PRIORITY.find((issue) => issues.includes(issue)) ?? null;
}

export const DELIVERY_ISSUE_REASON: Record<DeliveryIssue, string> = {
  not_configured: "Email sending isn't set up on this server yet.",
  rate_limited: "The email service is limiting how many emails we can send right now.",
  rejected:
    "The email service refused these addresses. Supabase's built-in email only reaches your own team until custom SMTP or a verified sending domain is set up.",
  failed: "The email service returned an error.",
};
