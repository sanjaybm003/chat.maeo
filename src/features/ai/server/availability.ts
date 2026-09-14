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
