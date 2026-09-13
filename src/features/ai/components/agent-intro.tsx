"use client";

import { useMessageActions } from "@/features/chat/hooks/use-message-actions";
import { useWorkspace } from "@/features/workspace/store/workspace-provider";
import { personColorStyle } from "@/lib/colors";
import type { Conversation } from "@/types/domain";

import { findModel } from "../models";
import { AgentAvatar, AgentTag } from "./agent-avatar";

/** The top of an agent room: who the agent is, and a few ways to start. */
export function AgentIntro({ conversation }: { conversation: Conversation }) {
  const agent = useWorkspace((state) => (conversation.agentId ? state.agents[conversation.agentId] : undefined));
  const actions = useMessageActions(conversation.id);

  if (!agent) {
    return (
      <div className="mb-6 mt-4 flex flex-col items-start gap-4 px-1 [--avatar-ring:var(--paper)]">
        <AgentAvatar agent={null} size="xl" />
        <div>
          <h2 className="font-display text-[26px] font-semibold leading-tight tracking-[-0.02em]">This agent was removed</h2>
          <p className="mt-1 max-w-[460px] text-[14px] text-ink-3">The conversation stays here for you to read.</p>
        </div>
      </div>
    );
  }

  const model = findModel(agent.model);
  const canAsk = !agent.archivedAt;

  return (
    <div className="mb-8 mt-4 flex flex-col items-start gap-4 px-1" style={personColorStyle(agent.color)}>
      <AgentAvatar agent={agent} size="xl" />
      <div>
        <h2 className="flex items-center gap-2 font-display text-[26px] font-semibold leading-tight tracking-[-0.02em]">
          {agent.name}
          <AgentTag />
        </h2>
        <p className="mt-1 max-w-[520px] text-[14.5px] leading-relaxed text-ink-2">{agent.tagline || "An AI agent in your workspace."}</p>
        <p className="mt-2 font-mono text-[11px] text-ink-3">
          @{agent.handle} · {model?.label ?? agent.model} · only you can see this chat
        </p>
      </div>

      {canAsk && agent.starters.length > 0 ? (
        <div className="flex max-w-[640px] flex-wrap gap-2">
          {agent.starters.map((starter) => (
            <button
              key={starter}
              type="button"
              onClick={() => void actions.send({ body: starter, attachments: [], replyTo: null })}
              className="rounded-[16px] rounded-bl-[5px] border border-line-2 bg-surface px-3.5 py-2 text-left text-[13.5px] leading-snug text-ink-2 transition-[border-color,color,transform] duration-150 hover:-translate-y-px hover:border-person hover:text-ink"
            >
              {starter}
            </button>
          ))}
        </div>
      ) : null}

      {agent.archivedAt ? <p className="text-[13.5px] text-ink-3">This agent is archived and no longer replies.</p> : null}
    </div>
  );
}
