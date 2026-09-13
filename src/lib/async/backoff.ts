export interface BackoffOptions {
  /** Delay ceiling for the first retry. */
  baseMs: number;
  /** Absolute ceiling, however many attempts have failed. */
  maxMs: number;
  /** Smallest delay returned, so retries never hot-loop. */
  minMs?: number;
  random?: () => number;
}

/**
 * Exponential backoff with "full jitter": a uniform delay in
 * [min, min(max, base · 2^attempt)]. Randomising the whole window spreads
 * retries from many clients that failed at the same moment (a deploy, a
 * dropped connection), which avoids a synchronized thundering herd.
 */
export function backoffDelay(attempt: number, { baseMs, maxMs, minMs = 0, random = Math.random }: BackoffOptions) {
  const ceiling = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt));
  return Math.max(minMs, Math.round(random() * ceiling));
}
