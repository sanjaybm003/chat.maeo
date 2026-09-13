import type { Conversation } from "@/types/domain";

import { indexBy, latestOf, time } from "../helpers";
import type { ConversationsSlice, SliceCreator } from "../types";

export const createConversationsSlice: SliceCreator<ConversationsSlice> = (set, get, bootstrap) => ({
  conversations: indexBy(bootstrap.conversations),
  activeConversationId: null,

  setConversations: (list) =>
    set((state) => {
      const conversations = indexBy(list);
      const active = state.activeConversationId;
      if (active && !conversations[active] && state.conversations[active]) {
        conversations[active] = state.conversations[active];
      }
      return { conversations };
    }),

  upsertConversation: (conversation) =>
    set((state) => ({ conversations: { ...state.conversations, [conversation.id]: conversation } })),

  patchConversation: (conversationId, patch) =>
    set((state) => {
      const current = state.conversations[conversationId];
      if (!current) return {};
      return { conversations: { ...state.conversations, [conversationId]: { ...current, ...patch } } };
    }),

  removeConversation: (conversationId) =>
    set((state) => {
      const conversations = { ...state.conversations };
      const threads = { ...state.threads };
      delete conversations[conversationId];
      delete threads[conversationId];
      return { conversations, threads };
    }),

  setActiveConversation: (conversationId) => {
    set({ activeConversationId: conversationId });
    if (conversationId) get().retainThread(conversationId);
  },

  incrementUnread: (conversationId) =>
    set((state) => {
      const current = state.conversations[conversationId];
      if (!current) return {};
      return {
        conversations: {
          ...state.conversations,
          [conversationId]: { ...current, unreadCount: current.unreadCount + 1 },
        },
      };
    }),

  setParticipantRead: (conversationId, userId, lastReadAt) =>
    set((state) => {
      const current = state.conversations[conversationId];
      if (!current) return {};
      const participants = current.participants.map((participant) =>
        participant.userId === userId
          ? { ...participant, lastReadAt: latestOf(participant.lastReadAt, lastReadAt) }
          : participant,
      );
      let next: Conversation = { ...current, participants };
      if (userId === state.me.id) {
        const readAt = latestOf(current.lastReadAt, lastReadAt);
        const last = current.lastMessage;
        const caughtUp = !last || last.senderId === userId || time(last.createdAt) <= time(readAt);
        next = { ...next, lastReadAt: readAt, unreadCount: caughtUp ? 0 : current.unreadCount };
      }
      return { conversations: { ...state.conversations, [conversationId]: next } };
    }),
});
