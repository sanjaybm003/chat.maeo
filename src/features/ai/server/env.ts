import "server-only";

import { describeBedrockKey, onBedrock, readClaudeSettings, type BedrockEndpoint, type ClaudeHost } from "../claude-hosts";
import { AI_MODELS, type AiModel, type AiProvider } from "../models";
import { isModelRefused, isUnlistedOnBedrock } from "./availability";

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
  /** The bedrock-mantle endpoint's OpenAI-compatible API, where Bedrock's open models run. */
  get bedrockMantleUrl() {
    return (read("BEDROCK_OPENAI_BASE_URL") ?? `https://bedrock-mantle.${claude().bedrockRegion}.api.aws/v1`).replace(/\/+$/, "");
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
    case "bedrock":
      return Boolean(aiEnv.bedrockKey);
    case "google":
      return Boolean(aiEnv.geminiKey);
    case "openai":
      return Boolean(aiEnv.openaiKey);
    case "deepseek":
      return Boolean(aiEnv.deepseekKey);
  }
}

/**
 * Models this server can run right now, in preference order, as they are
 * served here: Claude on Bedrock comes without web search and at Bedrock's
 * price, open models Bedrock doesn't list for this key and region are left
 * out, and so are models the account was recently refused while any others
 * remain.
 */
export function configuredModels(): AiModel[] {
  const claudeOnBedrock = aiEnv.claudeHost === "bedrock";
  const served = AI_MODELS.filter(
    (model) => isProviderConfigured(model.provider) && !(model.provider === "bedrock" && isUnlistedOnBedrock(model.id)),
  ).map((model) => (claudeOnBedrock && model.provider === "anthropic" ? onBedrock(model) : model));
  const usable = served.filter((model) => !isModelRefused(model.id));
  return usable.length > 0 ? usable : served;
}
