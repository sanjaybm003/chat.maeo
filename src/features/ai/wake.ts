import type { Agent, Conversation } from "@/types/domain";

import { extractMentionHandles } from "./mentions";

export const MAX_AGENTS_PER_MESSAGE = 3;

/**
 * Which agents a message calls on, in order:
 *   1. the agent of an agent room, which answers everything said there
 *   2. the agent whose message is being replied to, so a thread with an agent
 *      carries on without mentioning it again
 *   3. every active agent @mentioned, in the order they appear
 * Agents the person isn't allowed to use are left out. The server applies the
 * same rules again with its own data.
 */
export function agentsToWake(
  body: string,
  conversation: Pick<Conversation, "agentId"> | undefined,
  agents: Record<string, Agent>,
  replyTo?: { agentId: string | null } | null,
  canUse: (agent: Agent) => boolean = () => true,
): Agent[] {
  const woken: Agent[] = [];
  const add = (agent: Agent | undefined) => {
    if (agent && !agent.archivedAt && canUse(agent) && !woken.includes(agent)) woken.push(agent);
  };

  if (conversation?.agentId) add(agents[conversation.agentId]);
  if (replyTo?.agentId) add(agents[replyTo.agentId]);

  const active = Object.values(agents).filter((agent) => !agent.archivedAt);
  for (const handle of extractMentionHandles(body, MAX_AGENTS_PER_MESSAGE + 2)) {
    add(active.find((agent) => agent.handle === handle));
  }
  return woken.slice(0, MAX_AGENTS_PER_MESSAGE);
}
