import "server-only";

import type { AiProvider } from "../../models";
import { anthropicProvider } from "./anthropic";
import { googleProvider } from "./google";
import { bedrockProvider, deepseekProvider, openaiProvider } from "./openai-compatible";
import type { AiProviderClient } from "./types";

const REGISTRY: Record<AiProvider, AiProviderClient> = {
  anthropic: anthropicProvider,
  google: googleProvider,
  openai: openaiProvider,
  deepseek: deepseekProvider,
  bedrock: bedrockProvider,
};

export function providerClient(provider: AiProvider): AiProviderClient {
  return REGISTRY[provider];
}

export { ProviderError } from "./types";
export type { AiProviderClient, ProviderSession, StepResult, StepUsage, ToolCall, ToolResult, ToolSpec } from "./types";
