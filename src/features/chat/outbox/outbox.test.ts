import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Message } from "@/types/domain";

import { Outbox, type NewOutboxEntry, type OutboxEntry, type OutboxStorage } from "./outbox";

function draft(id: string, conversationId = "c1", createdAt = new Date().toISOString()): NewOutboxEntry {
  return {
    id,
    workspaceId: "w",
    conversationId,
    senderId: "me",
    body: id,
    attachments: [],
    replyToId: null,
    replyTo: null,
    createdAt,
  };
}

function memoryStorage(initial: OutboxEntry[] = []) {
  const storage: OutboxStorage & { saved: OutboxEntry[] } = {
    saved: initial,
    load: async () => storage.saved,
    save: async (entries) => {
      storage.saved = entries;
    },
  };
  return storage;
}

const delivered = (entry: OutboxEntry) => ({ id: entry.id }) as Message;
const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-14T12:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("Outbox", () => {
  it("sends one message per conversation at a time, in the order they were queued", async () => {
    const waiting = new Map<string, (message: Message) => void>();
    const send = vi.fn((entry: OutboxEntry) => new Promise<Message>((resolve) => waiting.set(entry.id, resolve)));
    const onSent = vi.fn();
    const outbox = new Outbox({ transport: { send }, storage: memoryStorage(), listener: { onSent, onFailed: vi.fn() } });
    outbox.start();

    outbox.enqueue(draft("a1", "A"));
    outbox.enqueue(draft("a2", "A"));
    outbox.enqueue(draft("b1", "B"));
    expect(send.mock.calls.map(([entry]) => entry.id)).toEqual(["a1", "b1"]);

    waiting.get("a1")?.({ id: "a1" } as Message);
    await flush();
    expect(send.mock.calls.map(([entry]) => entry.id)).toEqual(["a1", "b1", "a2"]);
    expect(onSent).toHaveBeenCalledTimes(1);
  });

  it("retries transient failures with backoff, then delivers and forgets the entry", async () => {
    const send = vi
      .fn<(entry: OutboxEntry) => Promise<Message>>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockImplementation(async (entry) => delivered(entry));
    const onSent = vi.fn();
    const onRetry = vi.fn();
    const storage = memoryStorage();
    const outbox = new Outbox({
      transport: { send },
      storage,
      listener: { onSent, onFailed: vi.fn(), onRetry },
      random: () => 0,
    });
    outbox.start();
    outbox.enqueue(draft("m1"));
    await flush();

    expect(onRetry).toHaveBeenCalledWith(expect.objectContaining({ id: "m1", attempts: 1 }), 250, expect.objectContaining({ kind: "network" }));
    await vi.advanceTimersByTimeAsync(249);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(2);
    expect(onSent).toHaveBeenCalledTimes(1);
    expect(outbox.size).toBe(0);
    expect(storage.saved).toEqual([]);
  });

  it("honours the server's retry-after on rate limits", async () => {
    const onRetry = vi.fn();
    const outbox = new Outbox({
      transport: {
        send: vi.fn().mockRejectedValue({ code: "P0429", message: "Slow down.", hint: "retry_after=7" }),
      },
      storage: memoryStorage(),
      listener: { onSent: vi.fn(), onFailed: vi.fn(), onRetry },
    });
    outbox.start();
    outbox.enqueue(draft("m1"));
    await flush();
    expect(onRetry.mock.calls[0][1]).toBe(7000);
  });

  it("stops on permanent failures and lets later messages in the conversation through", async () => {
    const send = vi.fn(async (entry: OutboxEntry) => {
      if (entry.id === "bad") throw { code: "22023", message: "One of the attachments is invalid." };
      return delivered(entry);
    });
    const onFailed = vi.fn();
    const outbox = new Outbox({ transport: { send }, storage: memoryStorage(), listener: { onSent: vi.fn(), onFailed } });
    outbox.start();
    outbox.enqueue(draft("bad"));
    outbox.enqueue(draft("good"));
    await flush();
    await flush();

    expect(onFailed).toHaveBeenCalledWith(expect.objectContaining({ id: "bad", state: "failed" }), expect.objectContaining({ kind: "invalid" }));
    expect(send.mock.calls.map(([entry]) => entry.id)).toEqual(["bad", "good"]);
    expect(outbox.get("bad")?.state).toBe("failed");
  });

  it("restores persisted work, refusing to auto-send anything too old", async () => {
    const stale: OutboxEntry = {
      ...draft("old", "c1", "2026-09-10T12:00:00Z"),
      attempts: 2,
      nextAttemptAt: 0,
      state: "pending",
      lastError: null,
    };
    const fresh: OutboxEntry = { ...draft("new", "c2"), attempts: 0, nextAttemptAt: 0, state: "pending", lastError: null };
    const send = vi.fn(async (entry: OutboxEntry) => delivered(entry));
    const outbox = new Outbox({ transport: { send }, storage: memoryStorage([stale, fresh]), listener: { onSent: vi.fn(), onFailed: vi.fn() } });
    outbox.start();

    const restored = await outbox.restore();
    await flush();
    expect(restored.find((entry) => entry.id === "old")?.state).toBe("failed");
    expect(send.mock.calls.map(([entry]) => entry.id)).toEqual(["new"]);
  });

  it("kick() skips the rest of a backoff and discard() cancels the send", async () => {
    const send = vi.fn<(entry: OutboxEntry) => Promise<Message>>().mockRejectedValue(new TypeError("Failed to fetch"));
    const outbox = new Outbox({
      transport: { send },
      storage: memoryStorage(),
      listener: { onSent: vi.fn(), onFailed: vi.fn() },
      random: () => 0.99,
    });
    outbox.start();
    outbox.enqueue(draft("m1"));
    await flush();
    expect(send).toHaveBeenCalledTimes(1);

    outbox.kick();
    await flush();
    expect(send).toHaveBeenCalledTimes(2);

    outbox.discard("m1");
    await vi.advanceTimersByTimeAsync(60_000);
    expect(send).toHaveBeenCalledTimes(2);
    expect(outbox.size).toBe(0);
  });
});
