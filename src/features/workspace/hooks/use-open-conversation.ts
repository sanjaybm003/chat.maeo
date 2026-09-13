"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { toast } from "sonner";

import { getErrorMessage } from "@/lib/errors";
import { routes } from "@/lib/routes";

import { fetchConversation, openDirectConversation } from "../api/conversations";
import { useWorkspaceStore } from "../store/workspace-provider";

export function useOpenConversation() {
  const store = useWorkspaceStore();
  const router = useRouter();

  return useCallback(
    async (conversationId: string, focusMessageId?: string) => {
      const { workspace, conversations } = store.getState();
      if (!conversations[conversationId]) {
        const conversation = await fetchConversation(workspace.id, conversationId).catch(() => null);
        if (conversation) store.getState().upsertConversation(conversation);
      }
      const href = routes.conversation(workspace.slug, conversationId);
      router.push(focusMessageId ? `${href}?message=${focusMessageId}` : href);
    },
    [store, router],
  );
}

/** One tap from a person to a conversation with them. */
export function useMessagePerson() {
  const store = useWorkspaceStore();
  const openConversation = useOpenConversation();

  return useCallback(
    async (userId: string) => {
      const { workspace, me } = store.getState();
      if (userId === me.id) return;
      try {
        const conversationId = await openDirectConversation(workspace.id, userId);
        await openConversation(conversationId);
      } catch (error) {
        toast.error(getErrorMessage(error, "Couldn't open that conversation."));
      }
    },
    [store, openConversation],
  );
}
