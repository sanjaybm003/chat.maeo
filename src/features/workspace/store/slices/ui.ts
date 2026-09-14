import type { SliceCreator, UiSlice } from "../types";

export const createUiSlice: SliceCreator<UiSlice> = (set) => ({
  drafts: {},
  replyTargets: {},
  editingMessageId: null,
  dialog: null,
  activityElsewhere: false,
  agentPanel: null,

  setDraft: (conversationId, text) =>
    set((state) => (state.drafts[conversationId] === text ? {} : { drafts: { ...state.drafts, [conversationId]: text } })),

  setReplyTarget: (conversationId, messageId) =>
    set((state) => ({ replyTargets: { ...state.replyTargets, [conversationId]: messageId } })),

  setEditingMessage: (messageId) => set({ editingMessageId: messageId }),
  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),
  flagActivityElsewhere: (active) => set({ activityElsewhere: active }),
  openAgentPanel: (conversationId, prompt) => set({ agentPanel: { conversationId, prompt } }),
  closeAgentPanel: () => set({ agentPanel: null }),
});
