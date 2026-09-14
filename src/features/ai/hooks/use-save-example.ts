"use client";

import { useCallback } from "react";
import { toast } from "sonner";

import { useWorkspaceStore } from "@/features/workspace/store/workspace-provider";
import type { Message } from "@/types/domain";

import { addAgentExample } from "../actions";
import { MAX_EXAMPLE_PROMPT, MAX_EXAMPLE_REPLY } from "../agent-spec";

/** Turns a good agent reply, with the message it answered, into an example the agent learns from. */
export function useSaveAsExample() {
  const store = useWorkspaceStore();

  return useCallback(
    async (reply: Message) => {
      const { agents, threads } = store.getState();
      const agent = reply.agentId ? agents[reply.agentId] : undefined;
      if (!agent) return;

      const thread = threads[reply.conversationId]?.messages ?? [];
      const quoted = reply.replyToId ? thread.find((item) => item.id === reply.replyToId) : undefined;
      const position = thread.findIndex((item) => item.id === reply.id);
      // In an agent's own room replies don't quote the question: it's the asker's last message before the reply.
      const earlier = thread
        .slice(0, Math.max(position, 0))
        .reverse()
        .find((item) => item.kind === "text" && !item.agentId && !item.deletedAt && item.senderId === reply.run?.requestedBy);
      const prompt = (quoted?.body ?? reply.replyTo?.body ?? earlier?.body ?? "").trim();
      if (!prompt) {
        toast.error("Couldn’t find the message this reply answered.");
        return;
      }

      const result = await addAgentExample(agent.id, {
        prompt: prompt.slice(0, MAX_EXAMPLE_PROMPT),
        reply: reply.body.trim().slice(0, MAX_EXAMPLE_REPLY),
      });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      store.getState().upsertAgent(result.data);
      toast.success(`Saved as an example for ${agent.name}`, { description: "It will answer similar messages this way." });
    },
    [store],
  );
}
