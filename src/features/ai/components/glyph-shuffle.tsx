"use client";

import { useEffect, useState } from "react";

import { personColorStyle } from "@/lib/colors";
import { cn } from "@/lib/utils";
import { AGENT_GLYPHS, PERSON_COLORS } from "@/types/domain";

import { AgentGlyphMark } from "./agent-avatar";

const START = AGENT_GLYPHS.map((glyph, index) => ({ glyph, color: PERSON_COLORS[(index * 3) % PERSON_COLORS.length], turns: 0 }));

/** Six marks trading shape and color while an agent is being designed. */
export function GlyphShuffle({ className }: { className?: string }) {
  const [tiles, setTiles] = useState(START);

  useEffect(() => {
    const timer = window.setInterval(() => {
      setTiles((current) => {
        const index = Math.floor(Math.random() * current.length);
        const next = [...current];
        next[index] = {
          glyph: AGENT_GLYPHS[Math.floor(Math.random() * AGENT_GLYPHS.length)],
          color: PERSON_COLORS[Math.floor(Math.random() * PERSON_COLORS.length)],
          turns: current[index].turns + 1,
        };
        return next;
      });
    }, 280);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className={cn("grid grid-cols-3 gap-1.5", className)} aria-hidden="true">
      {tiles.map((tile, index) => (
        <span
          key={index}
          className="flex size-11 items-center justify-center rounded-[13px] bg-person text-person-on transition-[background-color,color,transform] duration-300 ease-[var(--ease-snap)]"
          style={{ ...personColorStyle(tile.color), transform: `rotate(${tile.turns * 90}deg)` }}
        >
          <AgentGlyphMark glyph={tile.glyph} className="size-6" />
        </span>
      ))}
    </div>
  );
}
