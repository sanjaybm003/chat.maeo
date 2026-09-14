"use client";

import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/field";
import { IconSpark } from "@/components/ui/icons";
import { useWorkspace, useWorkspaceStore } from "@/features/workspace/store/workspace-provider";
import { getErrorMessage } from "@/lib/errors";
import type { Agent, Conversation } from "@/types/domain";

import { removeAgentFromConversation } from "../api";
import { SPECIALTY_PROFILES } from "../specialties";
import { AgentAvatar, AgentTag } from "./agent-avatar";

/** The agents working in a chat, for the details panel. */
export function ChatAgents({ conversation }: { conversation: Conversation }) {
  const store = useWorkspaceStore();
  const agents = useWorkspace((state) => state.agents);
  const openAgentPanel = useWorkspace((state) => state.openAgentPanel);
  const joined = conversation.agentIds.map((id) => agents[id]).filter((agent): agent is Agent => Boolean(agent && !agent.archivedAt));

  async function remove(agent: Agent) {
    const previous = conversation.agentIds;
    store.getState().patchConversation(conversation.id, { agentIds: previous.filter((id) => id !== agent.id) });
    try {
      await removeAgentFromConversation(conversation.id, agent.id);
    } catch (error) {
      store.getState().patchConversation(conversation.id, { agentIds: previous });
      toast.error(getErrorMessage(error, "Couldn't remove that agent."));
    }
  }

  return (
    <div className="border-t border-line px-2 pb-3 pt-4">
      <div className="flex items-center justify-between px-3">
        <SectionLabel>{joined.length ? `${joined.length} ${joined.length === 1 ? "agent" : "agents"}` : "Agents"}</SectionLabel>
        <Button size="sm" variant="ghost" data-agent-panel-toggle onClick={() => openAgentPanel(conversation.id)}>
          <IconSpark size={15} />
          Add
        </Button>
      </div>
      {joined.length === 0 ? (
        <p className="px-3 pt-1 text-[12.5px] leading-relaxed text-ink-3">Bring an agent in to work alongside everyone here.</p>
      ) : (
        <ul className="mt-1 flex flex-col">
          {joined.map((agent) => (
            <li key={agent.id} className="flex items-center gap-3 rounded-2xl px-3 py-2 transition-colors hover:bg-paper">
              <AgentAvatar agent={agent} size="md" />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[14px] font-medium text-ink">
                  <span className="truncate">{agent.name}</span>
                  <AgentTag />
                </span>
                <span className="block truncate text-[12.5px] text-ink-3">
                  @{agent.handle} · {SPECIALTY_PROFILES[agent.specialty].label}
                </span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => void remove(agent)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
