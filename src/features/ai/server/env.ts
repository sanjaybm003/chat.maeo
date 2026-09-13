import "server-only";

import { AI_MODELS, type AiModel, type AiProvider } from "../models";

const read = (name: string) => process.env[name]?.trim() || null;

export const aiEnv = {
  get anthropicKey() {
    return read("ANTHROPIC_API_KEY");
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
      return Boolean(aiEnv.anthropicKey);
    case "google":
      return Boolean(aiEnv.geminiKey);
    case "openai":
      return Boolean(aiEnv.openaiKey);
    case "deepseek":
      return Boolean(aiEnv.deepseekKey);
  }
}

/** Models this server can actually run, in preference order. */
export function configuredModels(): AiModel[] {
  return AI_MODELS.filter((model) => isProviderConfigured(model.provider));
}
