import "server-only";

import { ProviderError } from "./providers/types";

export type AgentRunErrorKind = "out_of_credits" | "unavailable" | "invalid";

/** A failure with a message written for the people in the chat. */
export class AgentRunError extends Error {
  constructor(
    message: string,
    readonly kind: AgentRunErrorKind = "invalid",
  ) {
    super(message);
    this.name = "AgentRunError";
  }
}

export class RunCancelledError extends Error {
  constructor() {
    super("The run was stopped.");
    this.name = "RunCancelledError";
  }
}

export class RunDeadlineError extends Error {
  constructor() {
    super("The run took too long.");
    this.name = "RunDeadlineError";
  }
}

/**
 * A short description of any thrown value for logs and the asker's private run
 * record: provider reasons, JavaScript errors, and database errors, which arrive
 * as plain objects. Null when there's nothing beyond the friendly message.
 */
export function describeFailure(error: unknown): string | null {
  if (error instanceof ProviderError) return error.detail ?? null;
  if (error instanceof AgentRunError) return null;
  if (error instanceof Error) return (error.message || error.name).slice(0, 300);
  if (typeof error === "string") return error.slice(0, 300) || null;
  if (error && typeof error === "object") {
    const { code, message, details, hint } = error as Record<string, unknown>;
    const parts = [code, message, details, hint].filter((part): part is string => typeof part === "string" && part.length > 0);
    if (parts.length > 0) return parts.join(" · ").slice(0, 300);
    try {
      return JSON.stringify(error).slice(0, 300);
    } catch {
      return null;
    }
  }
  return null;
}

export function friendlyRunError(error: unknown): string {
  if (error instanceof AgentRunError || error instanceof ProviderError) return error.message;
  if (error && typeof error === "object" && "code" in error && error.code === "P0402") {
    return "You’re out of AI credits.";
  }
  return "Something went wrong while replying. Try again.";
}
