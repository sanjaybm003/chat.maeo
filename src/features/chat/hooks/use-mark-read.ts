"use client";

import { useCallback, useEffect, useRef } from "react";

import { markConversationRead } from "@/features/workspace/api/conversations";
import { useWorkspaceStore } from "@/features/workspace/store/workspace-provider";

const FLUSH_DELAY_MS = 350;

/** Optimistically clears the badge, then tells the server once things settle. */
export function useMarkRead(conversationId: string) {
  const store = useWorkspaceStore();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pendingAt = useRef<string | null>(null);

  const flush = useCallback(() => {
    clearTimeout(timer.current);
    const readAt = pendingAt.current;
    pendingAt.current = null;
    if (readAt) {
      markConversationRead(conversationId, readAt).catch((error) => console.warn("[chat] mark read failed", error));
    }
  }, [conversationId]);

  useEffect(() => flush, [flush]);

  return useCallback(
    (readAt: string) => {
      const state = store.getState();
      const conversation = state.conversations[conversationId];
      if (!conversation) return;

      const own = conversation.participants.find((participant) => participant.userId === state.me.id);
      const alreadyRead = Date.parse(readAt) <= Date.parse(own?.lastReadAt ?? conversation.lastReadAt);
      if (alreadyRead && conversation.unreadCount === 0) return;

      state.setParticipantRead(conversationId, state.me.id, readAt);
      state.patchConversation(conversationId, { unreadCount: 0 });

      pendingAt.current = readAt;
      clearTimeout(timer.current);
      timer.current = setTimeout(flush, FLUSH_DELAY_MS);
    },
    [conversationId, store, flush],
  );
}
