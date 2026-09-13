import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { backoffDelay } from "./backoff";
import { KeyedDebouncer } from "./keyed-debouncer";
import { TokenBucketLimiter } from "./token-bucket";

describe("backoffDelay", () => {
  it("grows the window exponentially and caps it", () => {
    const max = () => 0.999999;
    expect(backoffDelay(0, { baseMs: 1000, maxMs: 30_000, random: max })).toBe(1000);
    expect(backoffDelay(3, { baseMs: 1000, maxMs: 30_000, random: max })).toBe(8000);
    expect(backoffDelay(20, { baseMs: 1000, maxMs: 30_000, random: max })).toBe(30_000);
  });

  it("jitters across the whole window but respects the floor", () => {
    expect(backoffDelay(4, { baseMs: 1000, maxMs: 30_000, random: () => 0 })).toBe(0);
    expect(backoffDelay(4, { baseMs: 1000, maxMs: 30_000, minMs: 250, random: () => 0 })).toBe(250);
    expect(backoffDelay(4, { baseMs: 1000, maxMs: 30_000, random: () => 0.5 })).toBe(8000);
  });
});

describe("TokenBucketLimiter", () => {
  it("allows a burst up to capacity, then refuses with an exact wait", () => {
    let now = 0;
    const limiter = new TokenBucketLimiter(3, 1, 100, () => now);
    expect(limiter.take("ip").allowed).toBe(true);
    expect(limiter.take("ip").allowed).toBe(true);
    expect(limiter.take("ip").allowed).toBe(true);
    const refused = limiter.take("ip");
    expect(refused.allowed).toBe(false);
    expect(refused.retryAfterMs).toBe(1000);

    now = 1000;
    expect(limiter.take("ip").allowed).toBe(true);
  });

  it("keeps callers independent and evicts least recently used keys", () => {
    let now = 0;
    const limiter = new TokenBucketLimiter(1, 0.001, 2, () => now);
    expect(limiter.take("a").allowed).toBe(true);
    expect(limiter.take("b").allowed).toBe(true);
    expect(limiter.take("a").allowed).toBe(false);
    now = 1;
    expect(limiter.take("c").allowed).toBe(true); // evicts "b"
    expect(limiter.take("b").allowed).toBe(true); // "b" starts fresh
  });
});

describe("KeyedDebouncer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("runs once per key after the burst settles", () => {
    const task = vi.fn();
    const debouncer = new KeyedDebouncer<string>(100, task);
    debouncer.schedule("x");
    debouncer.schedule("x");
    debouncer.schedule("y");
    vi.advanceTimersByTime(50);
    debouncer.schedule("x");
    vi.advanceTimersByTime(99);
    expect(task).toHaveBeenCalledTimes(1);
    expect(task).toHaveBeenCalledWith("y");
    vi.advanceTimersByTime(1);
    expect(task).toHaveBeenCalledTimes(2);
    expect(task).toHaveBeenLastCalledWith("x");
    expect(debouncer.pending).toBe(0);
  });
});
