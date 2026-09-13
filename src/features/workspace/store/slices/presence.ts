import { TYPING_EXPIRY_MS } from "@/lib/constants";

import type { PresenceSlice, SliceCreator } from "../types";

export const createPresenceSlice: SliceCreator<PresenceSlice> = (set) => ({
  online: {},
  away: {},
  typing: {},
  connection: "connecting",

  setPresence: (entries) =>
    set(() => {
      const online: Record<string, true> = {};
      const away: Record<string, true> = {};
      for (const entry of entries) {
        if (entry.status === "away") away[entry.userId] = true;
        else online[entry.userId] = true;
      }
      return { online, away };
    }),

  setTyping: (conversationId, userId, typing) =>
    set((state) => {
      const forConversation = { ...(state.typing[conversationId] ?? {}) };
      if (typing) forConversation[userId] = Date.now() + TYPING_EXPIRY_MS;
      else if (forConversation[userId]) delete forConversation[userId];
      else return {};
      return { typing: { ...state.typing, [conversationId]: forConversation } };
    }),

  pruneTyping: () =>
    set((state) => {
      const now = Date.now();
      let changed = false;
      const typing: PresenceSlice["typing"] = {};
      for (const [conversationId, users] of Object.entries(state.typing)) {
        const kept: Record<string, number> = {};
        for (const [userId, expiresAt] of Object.entries(users)) {
          if (expiresAt > now) kept[userId] = expiresAt;
          else changed = true;
        }
        typing[conversationId] = kept;
      }
      return changed ? { typing } : {};
    }),

  setConnection: (connection) => set((state) => (state.connection === connection ? {} : { connection })),
});
