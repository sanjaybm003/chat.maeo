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
}

export interface StepHooks {
  signal: AbortSignal;
  onText: (delta: string) => void;
  onActivity?: (step: AgentRunStep) => void;
}

export interface SessionOptions {
  model: AiModel;
  system: string;
  userMessage: string;
  tools: ToolSpec[];
  webSearch: boolean;
  maxOutputTokens: number;
  temperature?: number;
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
}

export interface AiProviderClient {
  createSession(options: SessionOptions): ProviderSession;
  generateObject<T>(request: StructuredRequest<T>): Promise<{ value: T; usage: StepUsage }>;
}

export type ProviderErrorKind = "not_configured" | "auth" | "rate_limited" | "overloaded" | "bad_request" | "refused" | "network";

export class ProviderError extends Error {
  constructor(
    readonly kind: ProviderErrorKind,
    readonly provider: AiProvider,
    message: string,
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
