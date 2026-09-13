const FRIENDLY_MESSAGES: Array<[RegExp, string]> = [
  [/invalid login credentials/i, "That email and password don't match."],
  [/email not confirmed/i, "Confirm your email first. The link is in your inbox."],
  [/user already registered|already been registered/i, "An account with this email already exists. Try signing in."],
  [/password should be at least/i, "Use at least 8 characters for your password."],
  [/new password should be different/i, "Choose a password you haven't used here before."],
  [/rate limit|too many requests|security purposes/i, "Too many attempts. Wait a minute and try again."],
  [/signups not allowed|signup is disabled/i, "New sign-ups are turned off for this workspace."],
  [/provider is not enabled|unsupported provider/i, "That sign-in option isn't turned on yet."],
  [/jwt expired|invalid jwt|session.*missing/i, "Your session expired. Sign in again."],
  [/failed to fetch|networkerror|network request failed|load failed/i, "You seem to be offline. Check your connection."],
  [/duplicate key value/i, "That already exists."],
  [/violates row-level security|permission denied/i, "You don't have access to do that."],
];

export function getErrorMessage(error: unknown, fallback = "Something went wrong. Please try again.") {
  const raw = extractMessage(error);
  if (!raw) return fallback;
  for (const [pattern, friendly] of FRIENDLY_MESSAGES) {
    if (pattern.test(raw)) return friendly;
  }
  // Messages raised by our own database functions are written for people.
  if (/^[A-Z].*[.!?]$/.test(raw) && raw.length < 180) return raw;
  return fallback;
}

function extractMessage(error: unknown): string | null {
  if (!error) return null;
  if (typeof error === "string") return error;
  if (typeof error === "object" && "message" in error && typeof error.message === "string") {
    return error.message;
  }
  return null;
}

function field(error: unknown, key: string): string | null {
  if (typeof error !== "object" || error === null || !(key in error)) return null;
  const value = (error as Record<string, unknown>)[key];
  return value === undefined || value === null ? null : String(value);
}

export type ErrorKind =
  | "network"
  | "rate_limited"
  | "unauthorized"
  | "forbidden"
  | "invalid"
  | "conflict"
  | "not_found"
  | "server"
  | "unknown";

export interface ClassifiedError {
  kind: ErrorKind;
  /** Safe to try the same operation again later. */
  retryable: boolean;
  /** Server-provided wait, when it told us (rate limits). */
  retryAfterMs: number | null;
  code: string | null;
  message: string;
}

const INVALID_CODES = new Set(["22023", "22001", "22P02", "23502", "23503", "23514", "P0001", "PGRST102", "PGRST204"]);

/**
 * Maps anything thrown by Supabase, fetch or our own code onto a small set of
 * kinds that drive behaviour: retry, back off, sign in again, or give up.
 * Codes are Postgres SQLSTATEs and PostgREST PGRST codes.
 */
export function classifyError(error: unknown): ClassifiedError {
  const code = field(error, "code");
  const raw = extractMessage(error) ?? "";
  const message = getErrorMessage(error);
  const make = (kind: ErrorKind, retryable: boolean, retryAfterMs: number | null = null): ClassifiedError => ({
    kind,
    retryable,
    retryAfterMs,
    code,
    message,
  });

  if (code === "P0429") {
    const seconds = Number(/retry_after=(\d+)/.exec(field(error, "hint") ?? "")?.[1]);
    return make("rate_limited", true, Number.isFinite(seconds) ? seconds * 1000 : 5000);
  }
  if (
    (error instanceof TypeError && /fetch|network|load failed/i.test(raw)) ||
    /failed to fetch|networkerror|network request failed|load failed|timed? ?out|aborted|ECONNRESET|ETIMEDOUT/i.test(raw)
  ) {
    return make("network", true);
  }
  if (code === "28000" || code === "PGRST301" || code === "PGRST303" || /jwt/i.test(raw)) {
    return make("unauthorized", true);
  }
  if (code === "42501") return make("forbidden", false);
  if (code === "23505") return make("conflict", false);
  if (code === "PGRST116" || code === "P0002") return make("not_found", false);
  if (code && INVALID_CODES.has(code)) return make("invalid", false);
  if (code && /^(08|53|57|58|XX)/.test(code)) return make("server", true);
  if (code === "PGRST000" || code === "PGRST001" || code === "PGRST002") return make("server", true);
  return make("unknown", false);
}
