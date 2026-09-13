/**
 * The models maeosan can run agents on. Safe to import anywhere: no keys here,
 * only facts. A model is offered only when its provider's key is set on the
 * server (see server/env.ts).
 *
 * Prices are provider list prices in USD per million tokens, checked
 * 2026-09-13 against each provider's pricing page. Where a provider publishes a
 * higher rate for peak hours or a scheduled increase, the higher one is used so
 * credits never under-charge.
 */

export type AiProvider = "anthropic" | "google" | "openai" | "deepseek";
export type ModelTier = "fast" | "balanced" | "deep";

export interface AiModel {
  id: string;
  provider: AiProvider;
  label: string;
  tier: ModelTier;
  summary: string;
  inputPrice: number;
  outputPrice: number;
  contextWindow: number;
  /** Newer reasoning models reject sampling parameters outright. */
  supportsTemperature: boolean;
  /** Provider-hosted web search, when the model has it. */
  webSearch: "anthropic-dynamic" | "anthropic-basic" | null;
  preview?: boolean;
}

export const PROVIDERS: Record<AiProvider, { label: string; envKey: string }> = {
  anthropic: { label: "Anthropic", envKey: "ANTHROPIC_API_KEY" },
  openai: { label: "OpenAI", envKey: "OPENAI_API_KEY" },
  google: { label: "Google", envKey: "GEMINI_API_KEY" },
  deepseek: { label: "DeepSeek", envKey: "DEEPSEEK_API_KEY" },
};

export const TIER_LABELS: Record<ModelTier, string> = {
  fast: "Fast",
  balanced: "Balanced",
  deep: "Deep",
};

export const AI_MODELS: readonly AiModel[] = [
  {
    id: "claude-opus-5",
    provider: "anthropic",
    label: "Claude Opus 5",
    tier: "deep",
    summary: "Careful, multi-step thinking for work that has to be right.",
    inputPrice: 5,
    outputPrice: 25,
    contextWindow: 1_000_000,
    supportsTemperature: false,
    webSearch: "anthropic-dynamic",
  },
  {
    id: "claude-sonnet-5",
    provider: "anthropic",
    label: "Claude Sonnet 5",
    tier: "balanced",
    summary: "Sharp and quick at a fraction of Opus's cost.",
    inputPrice: 2,
    outputPrice: 10,
    contextWindow: 1_000_000,
    supportsTemperature: false,
    webSearch: "anthropic-dynamic",
  },
  {
    id: "claude-haiku-4-5",
    provider: "anthropic",
    label: "Claude Haiku 4.5",
    tier: "fast",
    summary: "Instant answers, triage and quick rewrites.",
    inputPrice: 1,
    outputPrice: 5,
    contextWindow: 200_000,
    supportsTemperature: true,
    webSearch: "anthropic-basic",
  },
  {
    id: "gpt-5.6-sol",
    provider: "openai",
    label: "GPT-5.6 Sol",
    tier: "deep",
    summary: "OpenAI's strongest model with chat tool calling.",
    inputPrice: 4,
    outputPrice: 20,
    contextWindow: 1_050_000,
    supportsTemperature: false,
    webSearch: null,
  },
  {
    id: "gpt-5.6-terra",
    provider: "openai",
    label: "GPT-5.6 Terra",
    tier: "balanced",
    summary: "A strong everyday model that balances quality and cost.",
    inputPrice: 2,
    outputPrice: 12,
    contextWindow: 1_050_000,
    supportsTemperature: false,
    webSearch: null,
  },
  {
    id: "gpt-5.6-luna",
    provider: "openai",
    label: "GPT-5.6 Luna",
    tier: "fast",
    summary: "Very cheap and fast for high-volume, simple jobs.",
    inputPrice: 0.2,
    outputPrice: 1.2,
    contextWindow: 1_050_000,
    supportsTemperature: false,
    webSearch: null,
  },
  {
    id: "gemini-3.1-pro-preview",
    provider: "google",
    label: "Gemini 3.1 Pro",
    tier: "deep",
    summary: "Google's most capable model, still in preview.",
    inputPrice: 2,
    outputPrice: 12,
    contextWindow: 1_000_000,
    supportsTemperature: false,
    webSearch: null,
    preview: true,
  },
  {
    // Google lists $0.75 / $3.75 until 31 Dec 2026, then $1.50 / $7.50.
    id: "gemini-3.8-flash",
    provider: "google",
    label: "Gemini 3.8 Flash",
    tier: "balanced",
    summary: "Fast, capable and generous with long conversations.",
    inputPrice: 1.5,
    outputPrice: 7.5,
    contextWindow: 1_000_000,
    supportsTemperature: false,
    webSearch: null,
  },
  {
    id: "gemini-3.5-flash-lite",
    provider: "google",
    label: "Gemini 3.5 Flash-Lite",
    tier: "fast",
    summary: "Light and inexpensive for quick lookups and summaries.",
    inputPrice: 0.3,
    outputPrice: 2.5,
    contextWindow: 1_000_000,
    supportsTemperature: false,
    webSearch: null,
  },
  {
    // DeepSeek's peak-hour rates; off-peak is half.
    id: "deepseek-v4-pro",
    provider: "deepseek",
    label: "DeepSeek V4 Pro",
    tier: "deep",
    summary: "Strong reasoning at a low price.",
    inputPrice: 1.32,
    outputPrice: 3.96,
    contextWindow: 1_000_000,
    supportsTemperature: true,
    webSearch: null,
  },
  {
    id: "deepseek-flash",
    provider: "deepseek",
    label: "DeepSeek Flash",
    tier: "fast",
    summary: "The cheapest capable option for everyday chat.",
    inputPrice: 0.3,
    outputPrice: 1.2,
    contextWindow: 1_000_000,
    supportsTemperature: true,
    webSearch: null,
  },
];

const BY_ID = new Map(AI_MODELS.map((model) => [model.id, model]));

export function findModel(id: string | null | undefined): AiModel | null {
  return id ? (BY_ID.get(id) ?? null) : null;
}

/** Drafting agents needs careful instruction-following, not deep reasoning. */
export const ARCHITECT_MODEL_PREFERENCE = [
  "claude-sonnet-5",
  "claude-opus-5",
  "gemini-3.8-flash",
  "gpt-5.6-terra",
  "deepseek-v4-pro",
] as const;

export function pickArchitectModel(available: readonly AiModel[]): AiModel | null {
  for (const id of ARCHITECT_MODEL_PREFERENCE) {
    const model = available.find((item) => item.id === id);
    if (model) return model;
  }
  return available[0] ?? null;
}

/** The catalog's order is the preference order: first available model in a tier wins. */
export function recommendModel(tier: ModelTier, available: readonly AiModel[]): AiModel | null {
  return available.find((model) => model.tier === tier) ?? available[0] ?? null;
}
