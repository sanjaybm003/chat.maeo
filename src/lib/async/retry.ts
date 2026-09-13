import { classifyError } from "@/lib/errors";

import { backoffDelay } from "./backoff";

export interface RetryOptions {
  attempts?: number;
  baseMs?: number;
  maxMs?: number;
  shouldRetry?: (error: unknown) => boolean;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Runs an operation, retrying transient failures (network drops, timeouts,
 * rate limits) with jittered exponential backoff. Permanent failures such as
 * permission or validation errors are thrown immediately.
 */
export async function withRetry<T>(operation: () => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const {
    attempts = 3,
    baseMs = 400,
    maxMs = 5000,
    shouldRetry = (error) => classifyError(error).retryable,
    sleep = defaultSleep,
  } = options;

  for (let attempt = 1; ; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      if (attempt >= attempts || !shouldRetry(error)) throw error;
      const hinted = classifyError(error).retryAfterMs;
      await sleep(hinted ?? backoffDelay(attempt - 1, { baseMs, maxMs, minMs: 100 }));
    }
  }
}
