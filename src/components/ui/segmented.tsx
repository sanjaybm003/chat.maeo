"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
}

interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: ReadonlyArray<SegmentedOption<T>>;
  label: string;
  size?: "sm" | "md";
  className?: string;
}

export function Segmented<T extends string>({ value, onChange, options, label, size = "md", className }: SegmentedProps<T>) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn("inline-flex items-center gap-0.5 rounded-full border border-line bg-surface p-[3px]", className)}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full font-medium transition-colors duration-150",
              size === "sm" ? "h-7 px-2.5 text-[12.5px]" : "h-8 px-3.5 text-[13px]",
              active ? "bg-ink text-paper" : "text-ink-3 hover:text-ink",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** Wrapping pill choices, for picking one of many (team size, use case…). */
export function ChoiceChips<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: Omit<SegmentedProps<T>, "size" | "value"> & { value: T | null }) {
  return (
    <div role="radiogroup" aria-label={label} className={cn("flex flex-wrap gap-2", className)}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className={cn(
              "h-9 rounded-full border px-4 text-sm font-medium transition-[background-color,border-color,color] duration-150",
              active
                ? "border-ink bg-ink text-paper"
                : "border-line-2 bg-surface text-ink-2 hover:border-ink-4 hover:text-ink",
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
