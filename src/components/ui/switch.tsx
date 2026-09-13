"use client";

import { Switch as SwitchPrimitive } from "radix-ui";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "relative inline-flex h-6 w-10 shrink-0 items-center rounded-full bg-line-2 p-0.5 transition-colors duration-200",
        "data-[state=checked]:bg-ink disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb className="block size-5 rounded-full bg-surface shadow-[0_1px_2px_rgb(0_0_0/0.18)] transition-transform duration-200 ease-[var(--ease-snap)] data-[state=checked]:translate-x-4" />
    </SwitchPrimitive.Root>
  );
}
