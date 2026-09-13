import { mapWithConcurrency } from "@/lib/async/pool";
import { withRetry } from "@/lib/async/retry";
import { logger } from "@/lib/logger";

import { fetchConversations } from "../api/conversations";
import { fetchMembers } from "../api/members";
import { fetchMessageChanges, fetchMessages } from "../api/messages";
import type { WorkspaceStore } from "../store/workspace-store";

const CHANGE_PAGE_SIZE = 200;
const MAX_CHANGE_PAGES = 10;
const THREAD_CONCURRENCY = 3;

const log = logger.child({ module: "sync" });

/**
 * Brings the local store back in line with the server after anything that
 * could have dropped realtime events: a reconnect, a sleeping laptop, a tab
 * left in the background.
 *
 * Conversations and members are refetched whole (they're small). Loaded
 * threads catch up through the change feed from their cursor, so only what
 * actually changed crosses the wire, edits, deletions and reactions included.
 * Requests are coalesced: at most one sync runs, with one more queued.
 */
export class SyncService {
  private running: Promise<void> | null = null;
  private queued = false;
  private active = false;

  constructor(private readonly store: WorkspaceStore) {}

  start() {
    this.active = true;
  }

  stop() {
    this.active = false;
  }

  request(reason: string): Promise<void> {
    if (!this.active) return Promise.resolve();
    if (this.running) {
      this.queued = true;
      return this.running;
    }

    this.running = this.run(reason)
      .catch((error) => log.warn("sync failed", { reason, error }))
      .finally(() => {
        this.running = null;
        if (this.queued && this.active) {
          this.queued = false;
          void this.request("queued");
        }
      });
    return this.running;
  }

  /** Pulls every change to one conversation since its cursor. */
  async catchUpThread(conversationId: string) {
    let cursor = this.store.getState().threads[conversationId]?.cursor ?? null;

    if (!cursor) {
      const { messages } = await withRetry(() => fetchMessages(conversationId));
      if (this.active) this.store.getState().applyChanges(conversationId, messages);
      return;
    }

    for (let page = 0; page < MAX_CHANGE_PAGES; page += 1) {
      const changes = await withRetry(() => fetchMessageChanges(conversationId, cursor!, CHANGE_PAGE_SIZE));
      if (!this.active) return;
      if (changes.length > 0) this.store.getState().applyChanges(conversationId, changes);
      if (changes.length < CHANGE_PAGE_SIZE) return;
      const last = changes[changes.length - 1];
      cursor = { at: last.updatedAt, id: last.id };
    }

    // Too far behind to replay: start again from the newest page.
    const { messages, hasMore } = await withRetry(() => fetchMessages(conversationId));
    if (this.active) this.store.getState().resetThread(conversationId, messages, hasMore);
  }

  private async run(reason: string) {
    const workspaceId = this.store.getState().workspace.id;
    const [conversations, members] = await Promise.all([
      withRetry(() => fetchConversations(workspaceId)),
      withRetry(() => fetchMembers(workspaceId)),
    ]);
    if (!this.active) return;

    this.store.getState().setConversations(conversations);
    this.store.getState().setMembers(members);

    const threadIds = Object.entries(this.store.getState().threads)
      .filter(([, thread]) => thread.status === "ready")
      .map(([conversationId]) => conversationId);

    const results = await mapWithConcurrency(threadIds, THREAD_CONCURRENCY, (conversationId) =>
      this.catchUpThread(conversationId),
    );
    const failed = results.filter((result) => result.status === "rejected").length;
    log.debug("sync complete", { reason, threads: threadIds.length, failed });
  }
}
