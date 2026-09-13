import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export function Kbd({ className, ...props }: ComponentProps<"kbd">) {
  return (
    <kbd
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-line-2 bg-surface px-1 font-mono text-[10.5px] font-medium text-ink-3",
        className,
      )}
      {...props}
    />
  );
}

export function CountBadge({ count, muted, className }: { count: number; muted?: boolean; className?: string }) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        "inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 font-mono text-[11px] font-semibold tabular-nums",
        muted ? "bg-paper-3 text-ink-2" : "bg-accent text-accent-ink",
        className,
      )}
      aria-label={`${count} unread`}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}
