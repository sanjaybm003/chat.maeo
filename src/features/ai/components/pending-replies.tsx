"use client";

import { useEffect } from "react";

import { compareTimestamps } from "@/features/workspace/store/helpers";
import { useWorkspace } from "@/features/workspace/store/workspace-provider";
import { personColorStyle } from "@/lib/colors";
import { joinNames } from "@/lib/utils";

import { AgentAvatar } from "./agent-avatar";

/** Long enough for a slow start; a reply that never began is reported by the send itself. */
const PENDING_MS = 15_000;

/**
 * The moment a message that calls on agents is sent, before the server has
 * started them: who is about to reply. Each agent gives way to its own reply
 * as soon as that lands in the chat.
 */
export function PendingReplies({ conversationId }: { conversationId: string }) {
  const pending = useWorkspace((state) => state.pendingReplies[conversationId]);
  const agents = useWorkspace((state) => state.agents);
  const messages = useWorkspace((state) => state.threads[conversationId]?.messages);
  const clearPendingReplies = useWorkspace((state) => state.clearPendingReplies);

  const trigger = pending ? messages?.find((message) => message.id === pending.messageId) : undefined;
  const waiting = pending
    ? pending.agentIds.filter(
        (agentId) =>
          !(
            trigger?.delivery === "sent" &&
            messages?.some((message) => message.agentId === agentId && message.run && compareTimestamps(message.createdAt, trigger.createdAt) > 0)
          ),
      )
    : [];
  const answered = Boolean(pending) && waiting.length === 0;

  useEffect(() => {
    if (!pending) return;
    if (answered) {
      clearPendingReplies(conversationId, pending.messageId);
      return;
    }
    const timer = window.setTimeout(
      () => clearPendingReplies(conversationId, pending.messageId),
      Math.max(0, pending.since + PENDING_MS - Date.now()),
    );
    return () => window.clearTimeout(timer);
  }, [pending, answered, conversationId, clearPendingReplies]);

  const shown = waiting.flatMap((agentId) => (agents[agentId] ? [agents[agentId]] : []));
  if (shown.length === 0) return null;

  return (
    <div className="mt-4 flex animate-rise items-center gap-2.5 px-1 [--avatar-ring:var(--paper)]" aria-live="polite" style={personColorStyle(shown[0].color)}>
      <div className="flex -space-x-2">
        {shown.slice(0, 3).map((agent) => (
          <AgentAvatar key={agent.id} agent={agent} size="sm" working />
        ))}
      </div>
      <span className="flex h-8 items-center gap-2 rounded-full border border-line bg-surface px-3 text-[12.5px] text-ink-3">
        <span className="flex h-3 items-end gap-[2px]" aria-hidden="true">
          <span className="agent-bar h-3 w-[3px] rounded-full bg-person" />
          <span className="agent-bar h-3 w-[3px] rounded-full bg-person" />
          <span className="agent-bar h-3 w-[3px] rounded-full bg-person" />
        </span>
        {joinNames(
          shown.map((agent) => agent.name),
          3,
        )}{" "}
        {shown.length === 1 ? "is" : "are"} on it
      </span>
    </div>
  );
}
