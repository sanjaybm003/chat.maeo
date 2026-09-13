"use client";

import { useCallback, useEffect } from "react";
import { toast } from "sonner";

import { outboxEntryToMessage } from "@/features/chat/outbox/outbox";
import { fetchMessages } from "@/features/workspace/api/messages";
import { useWorkspaceRuntime } from "@/features/workspace/runtime/workspace-runtime";
import { useWorkspace, useWorkspaceStore } from "@/features/workspace/store/workspace-provider";
import { withRetry } from "@/lib/async/retry";
import { logger } from "@/lib/logger";

const log = logger.child({ module: "thread" });

export function useThread(conversationId: string) {
  const store = useWorkspaceStore();
  const { outbox, sync } = useWorkspaceRuntime();
  const thread = useWorkspace((state) => state.threads[conversationId]);

  const load = useCallback(async () => {
    store.getState().startThreadLoad(conversationId);
    try {
      const { messages, hasMore } = await withRetry(() => fetchMessages(conversationId));
      store.getState().setThread(conversationId, messages, hasMore);
      // Messages still queued from an earlier session belong in place.
      for (const entry of outbox.entriesFor(conversationId)) {
        store.getState().receiveMessage(outboxEntryToMessage(entry));
      }
    } catch (error) {
      log.warn("failed to load messages", { conversationId, error });
      store.getState().failThread(conversationId);
    }
  }, [conversationId, outbox, store]);

  useEffect(() => {
    const existing = store.getState().threads[conversationId];
    if (!existing || existing.status === "error") {
      void load();
      return;
    }
    if (existing.status === "ready") {
      // Coming back to a chat: replay only what changed since we last looked.
      sync.catchUpThread(conversationId).catch((error) => log.warn("thread catch-up failed", { error }));
    }
  }, [conversationId, load, store, sync]);

  const loadOlder = useCallback(async () => {
    const current = store.getState().threads[conversationId];
    if (!current || current.status !== "ready" || !current.hasMore || current.loadingOlder) return;
    const oldest = current.messages.find((message) => message.delivery === "sent");
    if (!oldest) return;

    store.getState().setLoadingOlder(conversationId, true);
    try {
      const { messages, hasMore } = await withRetry(() => fetchMessages(conversationId, oldest));
      store.getState().prependMessages(conversationId, messages, hasMore);
    } catch {
      store.getState().setLoadingOlder(conversationId, false);
      toast.error("Couldn't load earlier messages.");
    }
  }, [conversationId, store]);

  return { thread, loadOlder, retry: load };
}
