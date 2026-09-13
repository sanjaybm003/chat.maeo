"use client";

import { Popover } from "radix-ui";
import type { ReactNode } from "react";

import { QUICK_REACTIONS } from "@/lib/constants";

const MORE_REACTIONS = [
  "😊", "😅", "🥲", "😍", "🤔", "😮", "😢", "😡",
  "🔥", "💯", "✅", "❌", "👏", "🙌", "💪", "🤝",
  "☕", "🚀", "⭐", "💡", "📌", "🎯", "🍕", "🌱",
];

interface ReactionPickerProps {
  onPick: (emoji: string) => void;
  onOpenChange?: (open: boolean) => void;
  children: ReactNode;
  side?: "top" | "bottom";
}

export function ReactionPicker({ onPick, onOpenChange, children, side = "top" }: ReactionPickerProps) {
  return (
    <Popover.Root onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side={side}
          sideOffset={8}
          collisionPadding={12}
          className="z-50 w-[292px] rounded-[20px] border border-line bg-surface p-2 shadow-pop outline-none data-[state=open]:animate-pop-in"
        >
          <div className="flex justify-between border-b border-line pb-2">
            {QUICK_REACTIONS.map((emoji) => (
              <Popover.Close key={emoji} asChild>
                <button
                  type="button"
                  onClick={() => onPick(emoji)}
                  className="flex size-10 items-center justify-center rounded-full text-[22px] transition-transform duration-150 hover:scale-125 hover:bg-paper"
                  aria-label={`React with ${emoji}`}
                >
                  {emoji}
                </button>
              </Popover.Close>
            ))}
          </div>
          <div className="grid grid-cols-8 gap-0.5 pt-2">
            {MORE_REACTIONS.map((emoji) => (
              <Popover.Close key={emoji} asChild>
                <button
                  type="button"
                  onClick={() => onPick(emoji)}
                  className="flex size-8 items-center justify-center rounded-lg text-[18px] hover:bg-paper"
                  aria-label={`React with ${emoji}`}
                >
                  {emoji}
                </button>
              </Popover.Close>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
