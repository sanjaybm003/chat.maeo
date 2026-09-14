"use client";

import { useCallback } from "react";

import { outboxEntryToMessage, type NewOutboxEntry } from "@/features/chat/outbox/outbox";
import { useWorkspaceRuntime } from "@/features/workspace/runtime/workspace-runtime";
import { useWorkspaceStore } from "@/features/workspace/store/workspace-provider";

/**
 * Sends a plain message to any conversation through the durable outbox, the
 * way the message bar does, so agents in that chat wake once it lands.
 */
export function useSendToConversation() {
  const store = useWorkspaceStore();
  const { outbox } = useWorkspaceRuntime();

  return useCallback(
    (conversationId: string, body: string) => {
      const { workspace, me } = store.getState();
      const entry: NewOutboxEntry = {
        id: crypto.randomUUID(),
        workspaceId: workspace.id,
        conversationId,
        senderId: me.id,
        body,
        attachments: [],
        replyToId: null,
        replyTo: null,
        agentModel: null,
        createdAt: new Date().toISOString(),
      };
      store.getState().receiveMessage(outboxEntryToMessage({ ...entry, attempts: 0, nextAttemptAt: 0, state: "pending", lastError: null }));
      outbox.enqueue(entry);
    },
    [store, outbox],
  );
}
