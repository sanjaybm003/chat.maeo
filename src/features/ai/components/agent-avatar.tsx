import type { ReactNode } from "react";

import { personColorStyle } from "@/lib/colors";
import { cn } from "@/lib/utils";
import type { Agent, AgentGlyph } from "@/types/domain";

/**
 * Agents wear a rounded square with a flat Bauhaus mark, never a face or
 * initials, so nobody mistakes one for a person at a glance.
 */

const GLYPHS: Record<AgentGlyph, ReactNode> = {
  orbit: (
    <>
      <circle cx="18" cy="22" r="9.5" fill="none" stroke="currentColor" strokeWidth="3.6" />
      <circle cx="29.5" cy="10.5" r="4.6" fill="currentColor" />
    </>
  ),
  prism: (
    <>
      <path d="M20 7 33 31H7Z" fill="currentColor" opacity="0.5" />
      <path d="M20 7 33 31H20Z" fill="currentColor" />
    </>
  ),
  wave: (
    <path
      d="M6 15.5c4.6-5 9.4-5 14 0s9.4 5 14 0M6 25.5c4.6-5 9.4-5 14 0s9.4 5 14 0"
      fill="none"
      stroke="currentColor"
      strokeWidth="3.6"
      strokeLinecap="round"
    />
  ),
  spark: <path d="M20 5c1.2 8.2 6.8 13.8 15 15-8.2 1.2-13.8 6.8-15 15-1.2-8.2-6.8-13.8-15-15C13.2 18.8 18.8 13.2 20 5Z" fill="currentColor" />,
  grid: (
    <>
      <rect x="8" y="8" width="10.5" height="10.5" rx="2" fill="currentColor" />
      <rect x="21.5" y="8" width="10.5" height="10.5" rx="5.25" fill="currentColor" opacity="0.5" />
      <rect x="8" y="21.5" width="10.5" height="10.5" rx="5.25" fill="currentColor" opacity="0.5" />
      <path d="M21.5 32V21.5H32A10.5 10.5 0 0 1 21.5 32Z" fill="currentColor" />
    </>
  ),
  bloom: (
    <>
      <circle cx="20" cy="12" r="6" fill="currentColor" />
      <circle cx="28" cy="20" r="6" fill="currentColor" opacity="0.5" />
      <circle cx="20" cy="28" r="6" fill="currentColor" />
      <circle cx="12" cy="20" r="6" fill="currentColor" opacity="0.5" />
    </>
  ),
};

export const GLYPH_LABELS: Record<AgentGlyph, string> = {
  orbit: "Orbit",
  prism: "Prism",
  wave: "Wave",
  spark: "Spark",
  grid: "Grid",
  bloom: "Bloom",
};

export function AgentGlyphMark({ glyph, className }: { glyph: AgentGlyph; className?: string }) {
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden="true" focusable="false">
      {GLYPHS[glyph]}
    </svg>
  );
}

const SIZES = {
  xs: "size-5 rounded-[6px]",
  sm: "size-7 rounded-[9px]",
  md: "size-9 rounded-[11px]",
  lg: "size-11 rounded-[13px]",
  xl: "size-16 rounded-[19px]",
  "2xl": "size-24 rounded-[28px]",
} as const;

export type AgentAvatarSize = keyof typeof SIZES;

interface AgentAvatarProps {
  agent: Pick<Agent, "name" | "color" | "glyph"> | null | undefined;
  size?: AgentAvatarSize;
  /** Breathes while the agent is working on a reply. */
  working?: boolean;
  className?: string;
}

export function AgentAvatar({ agent, size = "md", working, className }: AgentAvatarProps) {
  return (
    <span
      role="img"
      aria-label={agent ? `${agent.name}, AI agent` : "Removed agent"}
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center overflow-hidden",
        SIZES[size],
        agent ? "bg-person text-person-on" : "bg-paper-3 text-ink-3",
        className,
      )}
      style={agent ? personColorStyle(agent.color) : undefined}
    >
      <AgentGlyphMark glyph={agent?.glyph ?? "orbit"} className={cn("size-[70%]", working && "agent-working")} />
    </span>
  );
}

/** The small "AI" tag that follows an agent's name everywhere. */
export function AgentTag({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex h-[17px] items-center rounded-[5px] border border-line-2 px-1 font-mono text-[9.5px] font-medium uppercase leading-none tracking-[0.1em] text-ink-2",
        className,
      )}
    >
      AI
    </span>
  );
}
