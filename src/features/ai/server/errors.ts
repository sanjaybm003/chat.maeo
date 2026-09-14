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

export function friendlyRunError(error: unknown): string {
  if (error instanceof AgentRunError || error instanceof ProviderError) return error.message;
  if (error && typeof error === "object" && "code" in error && error.code === "P0402") {
    return "You’re out of AI credits.";
  }
  return "Something went wrong while replying. Try again.";
}
