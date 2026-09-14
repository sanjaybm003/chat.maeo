import type { AgentRunStep } from "@/types/domain";

import type { AiModel, AiProvider } from "../../models";

/** A function tool the model may call, described in plain JSON Schema. */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  callId: string;
  name: string;
  output: string;
  isError?: boolean;
}

export interface StepUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  webSearches: number;
}

/**
 * done        the model finished its answer
 * tool_calls  the model wants tool results before continuing
 * continue    a server-side tool paused the turn; call step() again
 * max_tokens  the answer hit the output limit
 * refused     the provider declined to answer
 */
export type StepOutcome = "done" | "tool_calls" | "continue" | "max_tokens" | "refused";

export interface StepResult {
  text: string;
  toolCalls: ToolCall[];
  usage: StepUsage;
  outcome: StepOutcome;
  servedModel?: string;
  /** Set when the account couldn't use the requested model and another one answered; bill with this one. */
  billedModel?: AiModel;
}

export interface StepHooks {
  signal: AbortSignal;
  onText: (delta: string) => void;
  onActivity?: (step: AgentRunStep) => void;
}

export type ReasoningEffort = "low" | "medium" | "high";

export interface SessionOptions {
  model: AiModel;
  system: string;
  userMessage: string;
  tools: ToolSpec[];
  webSearch: boolean;
  maxOutputTokens: number;
  temperature?: number;
  /** How long a reasoning model may think before answering, where the model takes it. */
  effort?: ReasoningEffort;
}

/** One conversation with a model. The session keeps the provider's own history format. */
export interface ProviderSession {
  step(hooks: StepHooks): Promise<StepResult>;
  addToolResults(results: ToolResult[]): void;
}

export interface StructuredRequest<T> {
  model: AiModel;
  system: string;
  prompt: string;
  jsonSchema: Record<string, unknown>;
  parse: (value: unknown) => T;
  maxOutputTokens: number;
  signal?: AbortSignal;
  effort?: ReasoningEffort;
}

export interface AiProviderClient {
  createSession(options: SessionOptions): ProviderSession;
  /** `model` is set when a different model than the requested one produced the result. */
  generateObject<T>(request: StructuredRequest<T>): Promise<{ value: T; usage: StepUsage; model?: AiModel }>;
}

/** unavailable: the AI account can't use this model right now; another model may still work. */
export type ProviderErrorKind =
  | "not_configured"
  | "auth"
  | "unavailable"
  | "rate_limited"
  | "overloaded"
  | "bad_request"
  | "refused"
  | "network";

export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    readonly provider: AiProvider,
    message: string,
    /** The provider's own reason, for logs and the asker's private run record. Never shown in the chat. */
    readonly detail?: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export const emptyUsage = (): StepUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  webSearches: 0,
});
