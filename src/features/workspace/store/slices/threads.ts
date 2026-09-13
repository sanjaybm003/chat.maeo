import type { Message } from "@/types/domain";

import { advanceCursor, mergeIntoThread, upsertSorted, withLatestPreview, withoutFinishedStreams } from "../helpers";
import type { SliceCreator, Thread, ThreadsSlice, WorkspaceStoreState } from "../types";

/** Loaded conversations kept in memory; colder ones reload on demand. */
export const MAX_CACHED_THREADS = 12;

const emptyThread = (): Thread => ({
  messages: [],
  status: "loading",
  hasMore: false,
  loadingOlder: false,
  cursor: null,
  lastViewedAt: Date.now(),
});

export const createThreadsSlice: SliceCreator<ThreadsSlice> = (set, get) => {
  const updateThread = (conversationId: string, update: (thread: Thread) => Thread) =>
    set((state) => {
      const thread = state.threads[conversationId];
      if (!thread) return {};
      return { threads: { ...state.threads, [conversationId]: update(thread) } };
    });

  const replaceThread = (conversationId: string, messages: Message[], hasMore: boolean, keep: (message: Message) => boolean) =>
    set((state) => {
      const existing = state.threads[conversationId];
      const extras = (existing?.messages ?? []).filter(
        (message) => keep(message) && !messages.some((item) => item.id === message.id),
      );
      const merged = extras.reduce(upsertSorted, messages);
      return {
        threads: {
          ...state.threads,
          [conversationId]: {
            messages: merged,
            status: "ready",
            hasMore,
            loadingOlder: false,
            cursor: advanceCursor(null, merged),
            lastViewedAt: existing?.lastViewedAt ?? Date.now(),
          },
        },
      };
    });

  return {
    threads: {},

    startThreadLoad: (conversationId) =>
      set((state) => ({
        threads: {
          ...state.threads,
          [conversationId]: state.threads[conversationId]
            ? { ...state.threads[conversationId], status: "loading", lastViewedAt: Date.now() }
            : emptyThread(),
        },
      })),

    // Anything optimistic or realtime that arrived while the page loaded stays.
    setThread: (conversationId, messages, hasMore) => replaceThread(conversationId, messages, hasMore, () => true),

    resetThread: (conversationId, messages, hasMore) =>
      replaceThread(conversationId, messages, hasMore, (message) => message.delivery !== "sent"),

    failThread: (conversationId) =>
      updateThread(conversationId, (thread) => ({ ...thread, status: "error", loadingOlder: false })),

    setLoadingOlder: (conversationId, loading) =>
      updateThread(conversationId, (thread) => ({ ...thread, loadingOlder: loading })),

    prependMessages: (conversationId, older, hasMore) =>
      updateThread(conversationId, (thread) => ({
        ...mergeIntoThread(thread, older, false).thread,
        hasMore,
        loadingOlder: false,
      })),

    applyChanges: (conversationId, messages) =>
      set((state) => {
        const thread = state.threads[conversationId];
        if (!thread || messages.length === 0) return {};
        const { thread: next, applied } = mergeIntoThread(thread, messages, false);
        const patch: Partial<WorkspaceStoreState> = { threads: { ...state.threads, [conversationId]: next } };
        const conversation = withLatestPreview(state.conversations[conversationId], applied);
        if (conversation) patch.conversations = { ...state.conversations, [conversationId]: conversation };
        const streams = withoutFinishedStreams(state.agentStreams, applied);
        if (streams) patch.agentStreams = streams;
        return patch;
      }),

    receiveMessage: (message, options) =>
      set((state) => {
        const patch: Partial<WorkspaceStoreState> = {};
        const thread = state.threads[message.conversationId];
        let applied: Message = message;

        if (thread?.status === "ready") {
          const { thread: next, applied: merged } = mergeIntoThread(thread, [message], Boolean(options?.keepReactions));
          if (merged.length === 0) return {};
          applied = merged[0];
          patch.threads = { ...state.threads, [message.conversationId]: next };
        }

        const conversation = withLatestPreview(state.conversations[message.conversationId], [applied]);
        if (conversation) patch.conversations = { ...state.conversations, [message.conversationId]: conversation };

        const streams = withoutFinishedStreams(state.agentStreams, [applied]);
        if (streams) patch.agentStreams = streams;

        if (message.senderId && state.typing[message.conversationId]?.[message.senderId]) {
          const forConversation = { ...state.typing[message.conversationId] };
          delete forConversation[message.senderId];
          patch.typing = { ...state.typing, [message.conversationId]: forConversation };
        }

        return patch;
      }),

    patchMessage: (conversationId, messageId, messagePatch) => {
      updateThread(conversationId, (thread) => ({
        ...thread,
        messages: thread.messages.map((message) => (message.id === messageId ? { ...message, ...messagePatch } : message)),
      }));
      const updated = get().threads[conversationId]?.messages.find((message) => message.id === messageId);
      const conversation = get().conversations[conversationId];
      if (updated && conversation?.lastMessage?.id === messageId) {
        const next = withLatestPreview(conversation, [updated]);
        if (next) get().patchConversation(conversationId, { lastMessage: next.lastMessage });
      }
    },

    removeMessage: (conversationId, messageId) =>
      updateThread(conversationId, (thread) => ({
        ...thread,
        messages: thread.messages.filter((message) => message.id !== messageId),
      })),

    applyReaction: (conversationId, messageId, reaction, added) =>
      updateThread(conversationId, (thread) => ({
        ...thread,
        messages: thread.messages.map((message) => {
          if (message.id !== messageId) return message;
          const exists = message.reactions.some((item) => item.userId === reaction.userId && item.emoji === reaction.emoji);
          if (added === exists) return message;
          return {
            ...message,
            reactions: added
              ? [...message.reactions, reaction]
              : message.reactions.filter((item) => !(item.userId === reaction.userId && item.emoji === reaction.emoji)),
          };
        }),
      })),

    retainThread: (conversationId) =>
      set((state) => {
        const threads = { ...state.threads };
        if (threads[conversationId]) {
          threads[conversationId] = { ...threads[conversationId], lastViewedAt: Date.now() };
        }

        let excess = Object.keys(threads).length - MAX_CACHED_THREADS;
        if (excess <= 0) return { threads };

        const coldestFirst = Object.entries(threads)
          .filter(([id, thread]) => id !== conversationId && thread.messages.every((message) => message.delivery === "sent"))
          .sort(([, a], [, b]) => a.lastViewedAt - b.lastViewedAt);

        for (const [id] of coldestFirst) {
          if (excess <= 0) break;
          delete threads[id];
          excess -= 1;
        }
        return { threads };
      }),
  };
};
