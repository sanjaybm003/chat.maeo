"use client";

import { useMemo } from "react";
import { toast } from "sonner";

import { outboxEntryToMessage, type NewOutboxEntry } from "@/features/chat/outbox/outbox";
import { removeUploadedAttachment } from "@/features/workspace/api/attachments";
import { addReaction, deleteMessage, editMessage, removeReaction } from "@/features/workspace/api/messages";
import { useWorkspaceRuntime } from "@/features/workspace/runtime/workspace-runtime";
import { useWorkspaceStore } from "@/features/workspace/store/workspace-provider";
import { withRetry } from "@/lib/async/retry";
import { getErrorMessage } from "@/lib/errors";
import type { Attachment, Message } from "@/types/domain";

export interface SendInput {
  body: string;
  attachments: Attachment[];
  replyTo: Message | null;
  /** A model for agent replies to this message, or null for each agent's own setting. */
  agentModel?: string | null;
}

export type MessageActions = ReturnType<typeof useMessageActions>;

/**
 * Every mutation is optimistic. Sends go through the durable outbox (ordered,
 * retried, survives reloads); edits, deletes and reactions retry transient
 * failures and roll back cleanly if the server refuses.
 */
export function useMessageActions(conversationId: string) {
  const store = useWorkspaceStore();
  const { outbox } = useWorkspaceRuntime();

  return useMemo(() => {
    const state = () => store.getState();
    const find = (messageId: string) => state().threads[conversationId]?.messages.find((item) => item.id === messageId);

    const toEntry = (message: Message): NewOutboxEntry => ({
      id: message.id,
      workspaceId: state().workspace.id,
      conversationId,
      senderId: state().me.id,
      body: message.body,
      attachments: message.attachments,
      replyToId: message.replyToId,
      replyTo: message.replyTo,
      createdAt: message.createdAt,
    });

    return {
      /** Resolves with the new message's id as soon as it's queued. */
      async send({ body, attachments, replyTo, agentModel }: SendInput): Promise<string> {
        const entry: NewOutboxEntry = {
          id: crypto.randomUUID(),
          workspaceId: state().workspace.id,
          conversationId,
          senderId: state().me.id,
          body,
          attachments,
          replyToId: replyTo?.id ?? null,
          replyTo: replyTo
            ? {
                id: replyTo.id,
                senderId: replyTo.senderId,
                agentId: replyTo.agentId,
                body: replyTo.body.slice(0, 200),
                attachmentCount: replyTo.attachments.length,
                deletedAt: replyTo.deletedAt,
              }
            : null,
          agentModel: agentModel ?? null,
          createdAt: new Date().toISOString(),
        };
        state().receiveMessage(outboxEntryToMessage({ ...entry, attempts: 0, nextAttemptAt: 0, state: "pending", lastError: null }));
        outbox.enqueue(entry);
        return entry.id;
      },

      async retry(message: Message) {
        state().patchMessage(conversationId, message.id, { delivery: "sending" });
        if (!outbox.retry(message.id)) outbox.enqueue(toEntry(message));
      },

      discard(message: Message) {
        outbox.discard(message.id);
        state().removeMessage(conversationId, message.id);
        for (const attachment of message.attachments) void removeUploadedAttachment(attachment.path);
      },

      async edit(message: Message, nextBody: string) {
        const body = nextBody.trim();
        if (body === message.body) return true;
        if (!body && message.attachments.length === 0) {
          toast.error("A message can't be empty. Delete it instead.");
          return false;
        }
        const previous = { body: message.body, editedAt: message.editedAt };
        state().patchMessage(conversationId, message.id, { body, editedAt: new Date().toISOString() });
        try {
          const saved = await withRetry(() => editMessage(message.id, body));
          state().receiveMessage(saved, { keepReactions: true });
          return true;
        } catch (error) {
          state().patchMessage(conversationId, message.id, previous);
          toast.error(getErrorMessage(error, "Couldn't save your edit."));
          return false;
        }
      },

      async remove(message: Message) {
        const previous = { body: message.body, attachments: message.attachments, deletedAt: message.deletedAt };
        state().patchMessage(conversationId, message.id, { body: "", attachments: [], deletedAt: new Date().toISOString() });
        try {
          await withRetry(() => deleteMessage(message.id));
          for (const attachment of previous.attachments) void removeUploadedAttachment(attachment.path);
        } catch (error) {
          state().patchMessage(conversationId, message.id, previous);
          toast.error(getErrorMessage(error, "Couldn't delete that message."));
        }
      },

      async toggleReaction(message: Message, emoji: string) {
        const meId = state().me.id;
        const had = Boolean(find(message.id)?.reactions.some((item) => item.userId === meId && item.emoji === emoji));
        state().applyReaction(conversationId, message.id, { emoji, userId: meId }, !had);
        try {
          await withRetry(() => (had ? removeReaction(message.id, meId, emoji) : addReaction(message.id, meId, emoji)));
        } catch (error) {
          state().applyReaction(conversationId, message.id, { emoji, userId: meId }, had);
          toast.error(getErrorMessage(error, "Couldn't update that reaction."));
        }
      },
    };
  }, [conversationId, outbox, store]);
}
