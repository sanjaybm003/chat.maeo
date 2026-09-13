"use client";

import { IconCheck } from "@/components/ui/icons";
import { PERSON_COLOR_LABELS } from "@/lib/colors";
import { cn } from "@/lib/utils";
import { PERSON_COLORS, type PersonColor } from "@/types/domain";

export function ColorPicker({ value, onChange }: { value: PersonColor; onChange: (color: PersonColor) => void }) {
  return (
    <div role="radiogroup" aria-label="Your color" className="flex flex-wrap gap-3">
      {PERSON_COLORS.map((color) => {
        const selected = value === color;
        return (
          <button
            key={color}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={PERSON_COLOR_LABELS[color]}
            title={PERSON_COLOR_LABELS[color]}
            onClick={() => onChange(color)}
            className={cn(
              "relative flex size-9 items-center justify-center rounded-full transition-transform duration-150 hover:scale-110",
              selected && "ring-2 ring-ink ring-offset-[3px] ring-offset-paper",
            )}
            style={{ backgroundColor: `var(--${color})`, color: `var(--${color}-on)` }}
          >
            {selected ? <IconCheck size={16} strokeWidth={2.2} /> : null}
          </button>
        );
      })}
    </div>
  );
}
