"use client";

import { personColorStyle } from "@/lib/colors";
import { cn } from "@/lib/utils";
import type { Specialty } from "@/types/domain";

import { SPECIALTY_LIST } from "../specialties";
import { AgentGlyphMark } from "./agent-avatar";

/** Pick-one-or-none chips for the kind of work, used when describing an agent. */
export function SpecialtyChips({
  value,
  onChange,
  disabled,
  className,
}: {
  value: Specialty | null;
  onChange: (value: Specialty | null) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label="Kind of work" className={cn("flex flex-wrap gap-1.5", className)}>
      {SPECIALTY_LIST.map((profile) => {
        const selected = value === profile.id;
        return (
          <button
            key={profile.id}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled}
            title={profile.summary}
            onClick={() => onChange(selected ? null : profile.id)}
            style={personColorStyle(profile.color)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-[12px] font-medium transition-[background-color,border-color,color] duration-150 disabled:pointer-events-none disabled:opacity-50",
              selected ? "border-transparent bg-person text-person-on" : "border-line bg-surface text-ink-2 hover:border-line-2 hover:text-ink",
            )}
          >
            <AgentGlyphMark glyph={profile.glyph} className="size-3.5" />
            {profile.label}
          </button>
        );
      })}
    </div>
  );
}
