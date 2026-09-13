import type { Agent, Conversation } from "@/types/domain";

import { extractMentionHandles } from "./mentions";

export const MAX_AGENTS_PER_MESSAGE = 3;

/**
 * Which agents a message calls on: the agent of an agent room always, plus
 * every active agent @mentioned, in the order they appear. The server applies
 * the same rule again with its own data.
 */
export function agentsToWake(
  body: string,
  conversation: Pick<Conversation, "agentId"> | undefined,
  agents: Record<string, Agent>,
): Agent[] {
  const active = Object.values(agents).filter((agent) => !agent.archivedAt);
  const woken: Agent[] = [];

  const roomAgent = conversation?.agentId ? agents[conversation.agentId] : undefined;
  if (roomAgent && !roomAgent.archivedAt) woken.push(roomAgent);

  for (const handle of extractMentionHandles(body, MAX_AGENTS_PER_MESSAGE + 1)) {
    const agent = active.find((item) => item.handle === handle);
    if (agent && !woken.includes(agent)) woken.push(agent);
  }
  return woken.slice(0, MAX_AGENTS_PER_MESSAGE);
}
