/**
 * Coalesces bursts of work per key: many `schedule("x")` calls within the
 * window run `task("x")` once. Used so a flurry of realtime hints about the
 * same conversation triggers a single refetch.
 */
export class KeyedDebouncer<Key> {
  private readonly timers = new Map<Key, ReturnType<typeof setTimeout>>();

  constructor(
    private readonly delayMs: number,
    private readonly task: (key: Key) => void,
  ) {}

  schedule(key: Key) {
    const existing = this.timers.get(key);
    if (existing) clearTimeout(existing);
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key);
        this.task(key);
      }, this.delayMs),
    );
  }

  cancel(key: Key) {
    const existing = this.timers.get(key);
    if (existing) clearTimeout(existing);
    this.timers.delete(key);
  }

  get pending() {
    return this.timers.size;
  }

  cancelAll() {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}
