"use client";

import { cn } from "@/lib/utils";
import type { Agent } from "@/types/domain";

import { AgentAvatar } from "./agent-avatar";

/** Active agents this person may use, matching what's typed after "@": handle prefix first, then name prefix, then anywhere. */
export function matchAgents(agents: Record<string, Agent>, query: string, limit = 6, canUse: (agent: Agent) => boolean = () => true): Agent[] {
  const q = query.toLowerCase();
  return Object.values(agents)
    .filter((agent) => !agent.archivedAt && canUse(agent))
    .map((agent) => {
      const name = agent.name.toLowerCase();
      const score = agent.handle.startsWith(q) ? 0 : name.startsWith(q) ? 1 : agent.handle.includes(q) || name.includes(q) ? 2 : -1;
      return { agent, score };
    })
    .filter((item) => item.score >= 0)
    .sort((a, b) => a.score - b.score || a.agent.name.localeCompare(b.agent.name))
    .slice(0, limit)
    .map((item) => item.agent);
}

interface MentionMenuProps {
  agents: Agent[];
  activeIndex: number;
  onPick: (agent: Agent) => void;
  onHover: (index: number) => void;
}

export function MentionMenu({ agents, activeIndex, onPick, onHover }: MentionMenuProps) {
  return (
    <div
      id="mention-menu"
      role="listbox"
      aria-label="Agents"
      className="absolute inset-x-0 bottom-full z-20 mb-2 animate-pop-in overflow-hidden rounded-[20px] border border-line bg-surface p-1.5 shadow-pop"
    >
      <p className="px-2.5 pb-1 pt-1.5 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">Agents</p>
      {agents.map((agent, index) => (
        <button
          key={agent.id}
          id={`mention-${agent.id}`}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          // Keep focus in the composer so typing carries on.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => onPick(agent)}
          onMouseMove={() => index !== activeIndex && onHover(index)}
          className={cn("flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left", index === activeIndex && "bg-paper")}
        >
          <AgentAvatar agent={agent} size="sm" />
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline gap-2">
              <span className="truncate text-[14px] font-medium text-ink">{agent.name}</span>
              <span className="shrink-0 font-mono text-[11.5px] text-ink-3">@{agent.handle}</span>
            </span>
            {agent.tagline ? <span className="block truncate text-[12.5px] text-ink-3">{agent.tagline}</span> : null}
          </span>
        </button>
      ))}
    </div>
  );
}
