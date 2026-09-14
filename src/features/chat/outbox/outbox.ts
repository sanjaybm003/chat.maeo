import { backoffDelay } from "@/lib/async/backoff";
import { classifyError, type ClassifiedError } from "@/lib/errors";
import type { Attachment, Message, ReplyPreview } from "@/types/domain";

export interface OutboxEntry {
  id: string;
  workspaceId: string;
  conversationId: string;
  senderId: string;
  body: string;
  attachments: Attachment[];
  replyToId: string | null;
  replyTo: ReplyPreview | null;
  /** A model picked for agent replies to this message; null uses each agent's own setting. */
  agentModel?: string | null;
  createdAt: string;
  attempts: number;
  nextAttemptAt: number;
  state: "pending" | "failed";
  lastError: string | null;
}

export type NewOutboxEntry = Omit<OutboxEntry, "attempts" | "nextAttemptAt" | "state" | "lastError">;

export interface OutboxTransport {
  send: (entry: OutboxEntry) => Promise<Message>;
}

export interface OutboxStorage {
  load: () => Promise<OutboxEntry[]>;
  save: (entries: OutboxEntry[]) => Promise<void>;
}

export interface OutboxListener {
  onSent: (entry: OutboxEntry, message: Message) => void;
  /** Permanent: not retryable, or out of attempts. The person can retry by hand. */
  onFailed: (entry: OutboxEntry, error: ClassifiedError) => void;
  onRetry?: (entry: OutboxEntry, delayMs: number, error: ClassifiedError) => void;
}

export interface OutboxPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** Messages older than this aren't sent automatically after a restart. */
  maxAgeMs: number;
}

export const DEFAULT_OUTBOX_POLICY: OutboxPolicy = {
  maxAttempts: 8,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  maxAgeMs: 3 * 24 * 60 * 60 * 1000,
};

interface OutboxOptions {
  transport: OutboxTransport;
  storage: OutboxStorage;
  listener: OutboxListener;
  policy?: Partial<OutboxPolicy>;
  now?: () => number;
  random?: () => number;
}

/**
 * A durable, ordered send queue.
 *
 * • Durable: persisted after every change, so a reload, crash or closed lid
 *   never loses a message someone pressed send on.
 * • Ordered: per conversation only the oldest pending message is in flight;
 *   later ones wait behind it, so the other side sees them in the order typed.
 * • Resilient: transient failures retry with exponential backoff and full
 *   jitter, honouring server retry-after hints; permanent failures stop.
 * • Idempotent: ids are generated on the client, so retrying a send that did
 *   land resolves to the stored message instead of creating a duplicate.
 */
export class Outbox {
  private readonly entries = new Map<string, OutboxEntry>();
  private readonly busyConversations = new Set<string>();
  private readonly policy: OutboxPolicy;
  private readonly now: () => number;
  private readonly random: () => number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private active = false;
  private persistChain: Promise<void> = Promise.resolve();

  constructor(private readonly options: OutboxOptions) {
    this.policy = { ...DEFAULT_OUTBOX_POLICY, ...options.policy };
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
  }

  start() {
    this.active = true;
    this.pump();
  }

  stop() {
    this.active = false;
    this.clearTimer();
  }

  /** Loads persisted entries (safe to call more than once) and resumes sending. */
  async restore(): Promise<OutboxEntry[]> {
    let saved: OutboxEntry[] = [];
    try {
      saved = await this.options.storage.load();
    } catch {
      saved = [];
    }

    const now = this.now();
    for (const entry of saved) {
      if (this.entries.has(entry.id)) continue;
      const tooOld = now - (Date.parse(entry.createdAt) || now) > this.policy.maxAgeMs;
      this.entries.set(entry.id, {
        ...entry,
        state: tooOld ? "failed" : entry.state,
        nextAttemptAt: now,
        lastError: tooOld ? "This message waited too long to send." : entry.lastError,
      });
    }
    if (saved.length > 0) this.persist();
    this.pump();
    return [...this.entries.values()];
  }

  enqueue(input: NewOutboxEntry) {
    this.entries.set(input.id, { ...input, attempts: 0, nextAttemptAt: this.now(), state: "pending", lastError: null });
    this.persist();
    this.pump();
  }

  retry(id: string) {
    const entry = this.entries.get(id);
    if (!entry) return false;
    this.entries.set(id, { ...entry, state: "pending", attempts: 0, nextAttemptAt: this.now(), lastError: null });
    this.persist();
    this.pump();
    return true;
  }

  discard(id: string) {
    const removed = this.entries.delete(id);
    if (removed) this.persist();
    this.pump();
    return removed;
  }

  /** The network is back: anything waiting out a backoff may go now. */
  kick() {
    const now = this.now();
    for (const [id, entry] of this.entries) {
      if (entry.state === "pending" && entry.nextAttemptAt > now) this.entries.set(id, { ...entry, nextAttemptAt: now });
    }
    this.pump();
  }

  get(id: string) {
    return this.entries.get(id);
  }

  entriesFor(conversationId: string) {
    return [...this.entries.values()].filter((entry) => entry.conversationId === conversationId);
  }

  get size() {
    return this.entries.size;
  }

  private pump() {
    this.clearTimer();
    if (!this.active) return;

    const now = this.now();
    const blocked = new Set(this.busyConversations);
    let wakeAt = Number.POSITIVE_INFINITY;

    // Map iteration is insertion order, so the first pending entry seen for a
    // conversation is its head; everything behind it waits.
    for (const entry of this.entries.values()) {
      if (entry.state !== "pending" || blocked.has(entry.conversationId)) continue;
      blocked.add(entry.conversationId);
      if (entry.nextAttemptAt > now) {
        wakeAt = Math.min(wakeAt, entry.nextAttemptAt);
        continue;
      }
      void this.attempt(entry);
    }

    if (Number.isFinite(wakeAt)) {
      this.timer = setTimeout(() => this.pump(), Math.max(0, wakeAt - now));
    }
  }

  private async attempt(entry: OutboxEntry) {
    this.busyConversations.add(entry.conversationId);
    try {
      const message = await this.options.transport.send(entry);
      if (this.entries.delete(entry.id)) this.persist();
      this.options.listener.onSent(entry, message);
    } catch (error) {
      this.handleFailure(entry.id, classifyError(error));
    } finally {
      this.busyConversations.delete(entry.conversationId);
      this.pump();
    }
  }

  private handleFailure(id: string, error: ClassifiedError) {
    const current = this.entries.get(id);
    if (!current) return;

    const attempts = current.attempts + 1;
    if (!error.retryable || attempts >= this.policy.maxAttempts) {
      const failed: OutboxEntry = { ...current, attempts, state: "failed", lastError: error.message };
      this.entries.set(id, failed);
      this.persist();
      this.options.listener.onFailed(failed, error);
      return;
    }

    const delay =
      error.retryAfterMs ??
      backoffDelay(attempts - 1, {
        baseMs: this.policy.baseDelayMs,
        maxMs: this.policy.maxDelayMs,
        minMs: 250,
        random: this.random,
      });
    const next: OutboxEntry = { ...current, attempts, nextAttemptAt: this.now() + delay, lastError: error.message };
    this.entries.set(id, next);
    this.persist();
    this.options.listener.onRetry?.(next, delay, error);
  }

  /** Writes are chained so an older snapshot can never land after a newer one. */
  private persist() {
    const snapshot = [...this.entries.values()];
    this.persistChain = this.persistChain.then(() => this.options.storage.save(snapshot)).catch(() => undefined);
  }

  private clearTimer() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}

/** How a queued entry looks in the conversation while it waits. */
export function outboxEntryToMessage(entry: OutboxEntry): Message {
  return {
    id: entry.id,
    conversationId: entry.conversationId,
    senderId: entry.senderId,
    agentId: null,
    kind: "text",
    body: entry.body,
    attachments: entry.attachments,
    meta: {},
    run: null,
    replyToId: entry.replyToId,
    replyTo: entry.replyTo,
    editedAt: null,
    deletedAt: null,
    createdAt: entry.createdAt,
    updatedAt: entry.createdAt,
    version: 0,
    reactions: [],
    delivery: entry.state === "failed" ? "failed" : "sending",
  };
}
