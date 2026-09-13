import type { AiModel } from "./models";

/**
 * Credit maths. 1 credit is a thousandth of a US dollar of provider list price,
 * so 10,000 credits covers about $10 of model usage.
 */

export const CREDITS_PER_USD = 1000;
export const WORKSPACE_STARTING_CREDITS = 10_000;

/** Anthropic web search: $10 per 1,000 searches. */
export const WEB_SEARCH_USD = 0.01;

/** Prompt-cache price multipliers relative to the input rate. */
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  webSearches?: number;
}

const nonNegative = (value: number | undefined) => (Number.isFinite(value) && (value ?? 0) > 0 ? (value as number) : 0);

function usdFor(model: AiModel, usage: TokenUsage) {
  const tokenCost =
    nonNegative(usage.inputTokens) * model.inputPrice +
    nonNegative(usage.cacheWriteTokens) * model.inputPrice * CACHE_WRITE_MULTIPLIER +
    nonNegative(usage.cacheReadTokens) * model.inputPrice * CACHE_READ_MULTIPLIER +
    nonNegative(usage.outputTokens) * model.outputPrice;
  return tokenCost / 1_000_000 + nonNegative(usage.webSearches) * WEB_SEARCH_USD;
}

/** What a finished model call costs. Any real usage costs at least one credit. */
export function creditsForUsage(model: AiModel, usage: TokenUsage): number {
  const usd = usdFor(model, usage);
  if (usd <= 0) return 0;
  return Math.max(1, Math.ceil(usd * CREDITS_PER_USD));
}

/** The worst case for the next call: all of the prompt plus a maximum-length answer. */
export function estimateReservation(
  model: AiModel,
  { inputTokens, maxOutputTokens, webSearches = 0 }: { inputTokens: number; maxOutputTokens: number; webSearches?: number },
): number {
  return creditsForUsage(model, { inputTokens, outputTokens: maxOutputTokens, webSearches }) + 1;
}

/** Deliberately pessimistic (about 3 characters per token) so holds cover real usage. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3);
}

/** A rough per-reply price for choosing a model: a busy chat's context and a paragraph back. */
export function typicalReplyCredits(model: AiModel): number {
  return creditsForUsage(model, { inputTokens: 4000, outputTokens: 500 });
}

const compact = new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 });
const full = new Intl.NumberFormat("en");

export function formatCredits(value: number, { compactAbove = 100_000 }: { compactAbove?: number } = {}) {
  const rounded = Math.round(value);
  return Math.abs(rounded) >= compactAbove ? compact.format(rounded) : full.format(rounded);
}
