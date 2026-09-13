interface Bucket {
  tokens: number;
  updatedAt: number;
}

export interface TakeResult {
  allowed: boolean;
  retryAfterMs: number;
}

/**
 * In-memory token bucket keyed by caller (IP, user…). Continuous refill, so a
 * caller that waits is never punished for an earlier burst. Bounded memory:
 * the least recently touched keys are evicted first.
 *
 * Per-instance only; the database enforces the limits that must be global.
 */
export class TokenBucketLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly capacity: number,
    private readonly refillPerSecond: number,
    private readonly maxKeys = 10_000,
    private readonly now: () => number = Date.now,
  ) {}

  take(key: string, cost = 1): TakeResult {
    const now = this.now();
    const existing = this.buckets.get(key);
    const elapsedSeconds = existing ? Math.max(0, now - existing.updatedAt) / 1000 : 0;
    const tokens = existing ? Math.min(this.capacity, existing.tokens + elapsedSeconds * this.refillPerSecond) : this.capacity;

    // Re-insert so Map iteration order doubles as least-recently-used order.
    this.buckets.delete(key);

    if (tokens < cost) {
      this.buckets.set(key, { tokens, updatedAt: now });
      return { allowed: false, retryAfterMs: Math.ceil(((cost - tokens) / this.refillPerSecond) * 1000) };
    }

    this.buckets.set(key, { tokens: tokens - cost, updatedAt: now });
    this.evict();
    return { allowed: true, retryAfterMs: 0 };
  }

  private evict() {
    while (this.buckets.size > this.maxKeys) {
      const oldest = this.buckets.keys().next().value;
      if (oldest === undefined) break;
      this.buckets.delete(oldest);
    }
  }
}
