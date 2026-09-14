import { indexBy, isRunLive } from "../helpers";
import type { AiSlice, SliceCreator } from "../types";

export const createAiSlice: SliceCreator<AiSlice> = (set, _get, bootstrap) => ({
  aiReady: bootstrap.ai.ready,
  aiModels: bootstrap.ai.models,
  aiWebSearch: bootstrap.ai.webSearch,
  agents: indexBy(bootstrap.ai.agents),
  credits: bootstrap.ai.credits,
  agentStreams: {},

  upsertAgent: (agent) => set((state) => ({ agents: { ...state.agents, [agent.id]: agent } })),

  removeAgent: (agentId) =>
    set((state) => {
      if (!state.agents[agentId]) return {};
      const agents = { ...state.agents };
      delete agents[agentId];
      return { agents };
    }),

  setCredits: (credits) => set({ credits }),

  // Realtime only knows the balance; the rest of the account catches up on the next load.
  setCreditBalance: (balance) =>
    set((state) => ({
      credits: state.credits
        ? { ...state.credits, balance }
        : { balance, reserved: 0, lifetimeGranted: balance, lifetimeUsed: 0 },
    })),

  applyAgentStream: (conversationId, messageId, stream) =>
    set((state) => {
      const current = state.agentStreams[messageId];
      if (current && current.runId === stream.runId && current.seq >= stream.seq) return {};

      // Snapshots only decorate a reply we already hold, from the same run, while it is live.
      // A late snapshot after the final message, or one for a run that isn't this message's, is dropped.
      const message = state.threads[conversationId]?.messages.find((item) => item.id === messageId);
      if (!message?.run || message.run.runId !== stream.runId || !isRunLive(message)) return {};

      return { agentStreams: { ...state.agentStreams, [messageId]: stream } };
    }),
});
