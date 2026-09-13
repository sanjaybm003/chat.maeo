"use client";

import { Tooltip as TooltipPrimitive } from "radix-ui";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export const TooltipProvider = TooltipPrimitive.Provider;

interface TooltipProps {
  label: ReactNode;
  shortcut?: string;
  side?: "top" | "right" | "bottom" | "left";
  children: ReactNode;
  className?: string;
}

export function Tooltip({ label, shortcut, side = "top", children, className }: TooltipProps) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          collisionPadding={8}
          className={cn(
            "z-[60] flex items-center gap-2 rounded-lg bg-inverse px-2 py-1 text-[12px] font-medium text-inverse-ink data-[state=delayed-open]:animate-fade-in",
            className,
          )}
        >
          {label}
          {shortcut ? <span className="font-mono text-[10.5px] opacity-60">{shortcut}</span> : null}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}
