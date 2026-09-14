import "server-only";

import { describeBedrockKey, onBedrock, readClaudeSettings, type BedrockEndpoint, type ClaudeHost } from "../claude-hosts";
import { AI_MODELS, type AiModel, type AiProvider } from "../models";

const read = (name: string) => process.env[name]?.trim() || null;
const claude = () => readClaudeSettings(process.env);

export const aiEnv = {
  /** A real Anthropic key; null when ANTHROPIC_API_KEY holds a Bedrock key. */
  get anthropicKey() {
    return claude().anthropicKey;
  },
  /** An Amazon Bedrock API key, from BEDROCK_API_KEY, AWS's own variable or Claude Code's layout. */
  get bedrockKey() {
    return claude().bedrockKey;
  },
  get bedrockRegion() {
    return claude().bedrockRegion;
  },
  /** When a short-term Bedrock key stops working; null for long-term keys. */
  get bedrockKeyExpiresAt(): Date | null {
    const key = claude().bedrockKey;
    return key ? (describeBedrockKey(key)?.expiresAt ?? null) : null;
  },
  /** Pins one Bedrock endpoint instead of trying the Messages endpoint first. */
  get bedrockEndpoint(): BedrockEndpoint | null {
    const value = read("BEDROCK_ENDPOINT");
    return value === "mantle" || value === "runtime" ? value : null;
  },
  /** Where Claude models run: Anthropic's API, Amazon Bedrock, or nowhere. */
  get claudeHost(): ClaudeHost | null {
    return claude().host;
  },
  get geminiKey() {
    return read("GEMINI_API_KEY") ?? read("GOOGLE_API_KEY");
  },
  get openaiKey() {
    return read("OPENAI_API_KEY");
  },
  get deepseekKey() {
    return read("DEEPSEEK_API_KEY");
  },
};

export function isProviderConfigured(provider: AiProvider): boolean {
  switch (provider) {
    case "anthropic":
      return aiEnv.claudeHost !== null;
    case "google":
      return Boolean(aiEnv.geminiKey);
    case "openai":
      return Boolean(aiEnv.openaiKey);
    case "deepseek":
      return Boolean(aiEnv.deepseekKey);
  }
}

/**
 * Models this server can actually run, in preference order, as they are
 * served here: Claude on Bedrock comes without web search and at Bedrock's price.
 */
export function configuredModels(): AiModel[] {
  const claudeOnBedrock = aiEnv.claudeHost === "bedrock";
  return AI_MODELS.filter((model) => isProviderConfigured(model.provider)).map((model) =>
    claudeOnBedrock && model.provider === "anthropic" ? onBedrock(model) : model,
  );
}
