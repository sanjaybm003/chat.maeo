import type { AiModel } from "./models";

/**
 * Where Claude models run. The same models, prompts and tools work on both;
 * only the connection, the model ids and a few server-side features differ.
 *
 *   anthropic  Anthropic's own API: web search and server-side fallbacks available
 *   bedrock    Amazon Bedrock, with a Bedrock API key: no web search, no fallbacks
 */
export type ClaudeHost = "anthropic" | "bedrock";

/**
 * Bedrock serves Claude from two endpoints:
 *   mantle   the Messages API at bedrock-mantle.{region}.api.aws (Opus 4.7 and later)
 *   runtime  InvokeModel at bedrock-runtime.{region}.amazonaws.com, with global inference profiles
 */
export type BedrockEndpoint = "mantle" | "runtime";

/**
 * Bedrock's regional endpoints cost 10% more than global ones. Credits are
 * billed as if regional, so they never under-charge whichever one serves a call.
 */
export const BEDROCK_PRICE_MULTIPLIER = 1.1;

const AWS_REGION = /^[a-z]{2}(-[a-z]+)+-\d$/;
const MANTLE_BASE_URL = /^https:\/\/bedrock-mantle\.([a-z0-9-]+)\.api\.aws(?:\/|$)/i;
const SHORT_TERM_KEY_PREFIX = "bedrock-api-key-";

export const isAwsRegion = (value: string) => AWS_REGION.test(value);

export function resolveClaudeHost({
  preferred,
  anthropicKey,
  bedrockKey,
}: {
  preferred: string | null;
  anthropicKey: string | null;
  bedrockKey: string | null;
}): ClaudeHost | null {
  if (preferred === "bedrock" && bedrockKey) return "bedrock";
  if (preferred === "anthropic" && anthropicKey) return "anthropic";
  if (anthropicKey) return "anthropic";
  if (bedrockKey) return "bedrock";
  return null;
}

export interface BedrockKeyInfo {
  region: string | null;
  expiresAt: Date | null;
}

/**
 * A short-term Amazon Bedrock API key is a presigned request, base64-encoded
 * after "bedrock-api-key-". Reading it, with no network call, gives the region
 * it was issued for and when it stops working. Other keys return null.
 */
export function describeBedrockKey(key: string): BedrockKeyInfo | null {
  if (!key.startsWith(SHORT_TERM_KEY_PREFIX)) return null;
  let decoded: string;
  try {
    decoded = atob(key.slice(SHORT_TERM_KEY_PREFIX.length));
  } catch {
    return { region: null, expiresAt: null };
  }

  const params = new URLSearchParams(decoded.slice(decoded.indexOf("?") + 1));
  const region = params.get("X-Amz-Credential")?.split("/")[2] ?? "";
  const stamp = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(params.get("X-Amz-Date") ?? "");
  const lifetime = Number(params.get("X-Amz-Expires"));
  const expiresAt =
    stamp && Number.isFinite(lifetime) && lifetime > 0
      ? new Date(Date.UTC(+stamp[1], +stamp[2] - 1, +stamp[3], +stamp[4], +stamp[5], +stamp[6]) + lifetime * 1000)
      : null;
  return { region: isAwsRegion(region) ? region : null, expiresAt };
}

export interface ClaudeSettings {
  anthropicKey: string | null;
  bedrockKey: string | null;
  bedrockRegion: string;
  host: ClaudeHost | null;
}

/**
 * Reads Claude's connection from the environment. Besides BEDROCK_API_KEY, it
 * understands the layout Claude Code uses for Bedrock: the Bedrock key in
 * ANTHROPIC_API_KEY with ANTHROPIC_BASE_URL at
 * https://bedrock-mantle.<region>.api.aws/anthropic. A short-term Bedrock key
 * in ANTHROPIC_API_KEY is recognised on its own.
 *
 * The region is BEDROCK_REGION, else the base URL's, else the key's own,
 * else us-east-1. Never AWS_REGION: Vercel sets that to wherever the function runs.
 */
export function readClaudeSettings(env: Readonly<Record<string, string | undefined>>): ClaudeSettings {
  const get = (name: string) => env[name]?.trim() || null;

  const anthropicValue = get("ANTHROPIC_API_KEY");
  const mantle = MANTLE_BASE_URL.exec(get("ANTHROPIC_BASE_URL") ?? "");
  const anthropicIsBedrock = anthropicValue !== null && (mantle !== null || anthropicValue.startsWith(SHORT_TERM_KEY_PREFIX));

  const bedrockKey = get("BEDROCK_API_KEY") ?? get("AWS_BEARER_TOKEN_BEDROCK") ?? (anthropicIsBedrock ? anthropicValue : null);
  const anthropicKey = anthropicIsBedrock ? null : anthropicValue;

  const configuredRegion = get("BEDROCK_REGION");
  const urlRegion = mantle?.[1]?.toLowerCase() ?? null;
  const bedrockRegion =
    (configuredRegion && isAwsRegion(configuredRegion) ? configuredRegion : null) ??
    (urlRegion && isAwsRegion(urlRegion) ? urlRegion : null) ??
    (bedrockKey ? (describeBedrockKey(bedrockKey)?.region ?? null) : null) ??
    "us-east-1";

  return {
    anthropicKey,
    bedrockKey,
    bedrockRegion,
    host: resolveClaudeHost({ preferred: get("CLAUDE_HOST"), anthropicKey, bedrockKey }),
  };
}

/** Runtime ids that don't follow the global.anthropic.<id> pattern. */
const RUNTIME_MODEL_IDS: Readonly<Record<string, string>> = {
  "claude-haiku-4-5": "global.anthropic.claude-haiku-4-5-20251001-v1:0",
};

export function bedrockModelId(modelId: string, endpoint: BedrockEndpoint) {
  return endpoint === "mantle" ? `anthropic.${modelId}` : (RUNTIME_MODEL_IDS[modelId] ?? `global.anthropic.${modelId}`);
}

const price = (value: number) => Math.round(value * BEDROCK_PRICE_MULTIPLIER * 1000) / 1000;

/** A Claude model as Bedrock serves it: no hosted web search, Bedrock pricing. */
export function onBedrock(model: AiModel): AiModel {
  return { ...model, webSearch: null, inputPrice: price(model.inputPrice), outputPrice: price(model.outputPrice) };
}
