import "server-only";

import { ProviderError } from "./providers/types";

/** How many different models one reply or draft tries before giving up. */
export const MAX_MODEL_ATTEMPTS = 3;

/** Failures another model may not share: this model is off-limits to the account, or its provider's key doesn't work. */
export const worthAnotherModel = (error: unknown) =>
  error instanceof ProviderError && (error.kind === "unavailable" || error.kind === "auth" || error.kind === "not_configured");

/**
 * Models the AI account was refused, remembered per server instance so routing
 * steers around them. Entries expire, so access granted later is noticed.
 */
export const REFUSED_MODEL_TTL_MS = 10 * 60 * 1000;

/** How providers word "this account can't use that model", as opposed to a malformed request. */
export const MODEL_PROBLEM = /\bmodels?\b|identifier|inference profile|throughput|not (?:currently )?(?:available|supported|enabled)|access to/i;

const refusedUntil = new Map<string, number>();

export function markModelRefused(modelId: string, now = Date.now()) {
  refusedUntil.set(modelId, now + REFUSED_MODEL_TTL_MS);
}

export function isModelRefused(modelId: string, now = Date.now()) {
  const until = refusedUntil.get(modelId);
  if (until === undefined) return false;
  if (until > now) return true;
  refusedUntil.delete(modelId);
  return false;
}

/** How long Bedrock's list of callable models is trusted, and how soon a failed read is tried again. */
export const BEDROCK_CATALOG_TTL_MS = 30 * 60 * 1000;
export const BEDROCK_CATALOG_RETRY_MS = 5 * 60 * 1000;

/** ids is null when the list couldn't be read or didn't look like Bedrock's: then nothing is hidden. */
let bedrockCatalog: { ids: ReadonlySet<string> | null; checkedAt: number } | null = null;

export function recordBedrockCatalog(ids: ReadonlySet<string> | null, now = Date.now()) {
  bedrockCatalog = { ids, checkedAt: now };
}

export function bedrockCatalogFresh(now = Date.now()) {
  if (!bedrockCatalog) return false;
  return now - bedrockCatalog.checkedAt < (bedrockCatalog.ids ? BEDROCK_CATALOG_TTL_MS : BEDROCK_CATALOG_RETRY_MS);
}

/** A model Bedrock's own list leaves out can't be called with this key in this region, so it isn't offered. */
export function isUnlistedOnBedrock(modelId: string) {
  return Boolean(bedrockCatalog?.ids && !bedrockCatalog.ids.has(modelId));
}
