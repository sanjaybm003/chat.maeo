"use client";

import { useCallback } from "react";
import { toast } from "sonner";

import { useOpenConversation } from "@/features/workspace/hooks/use-open-conversation";
import { getErrorMessage } from "@/lib/errors";

import { openAgentConversation } from "../api";

/** One tap from an agent to your private room with it. */
export function useOpenAgentRoom() {
  const openConversation = useOpenConversation();

  return useCallback(
    async (agentId: string) => {
      try {
        await openConversation(await openAgentConversation(agentId));
      } catch (error) {
        toast.error(getErrorMessage(error, "Couldn't open a chat with that agent."));
      }
    },
    [openConversation],
  );
}
