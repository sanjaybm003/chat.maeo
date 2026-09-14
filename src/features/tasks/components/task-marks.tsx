import { personColorStyle } from "@/lib/colors";
import { cn } from "@/lib/utils";
import type { TaskPriority, TaskStatus } from "@/types/domain";

import { TASK_STATUS_META } from "../lib/task-meta";

/** Status as a small mark: an empty ring to do, half full underway, a bar when blocked, filled when done. */
export function TaskStatusIcon({ status, size = 16, className }: { status: TaskStatus; size?: number; className?: string }) {
  const color = TASK_STATUS_META[status].color;
  return (
    <svg
      viewBox="0 0 16 16"
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
      className={cn("shrink-0", className)}
      style={color ? personColorStyle(color) : undefined}
    >
      {status === "todo" ? <circle cx="8" cy="8" r="6" fill="none" stroke="var(--ink-3)" strokeWidth="1.6" /> : null}
      {status === "in_progress" ? (
        <>
          <circle cx="8" cy="8" r="6" fill="none" stroke="var(--person)" strokeWidth="1.6" />
          <path d="M8 4.5a3.5 3.5 0 0 1 0 7Z" fill="var(--person)" />
        </>
      ) : null}
      {status === "blocked" ? (
        <>
          <circle cx="8" cy="8" r="6" fill="none" stroke="var(--person)" strokeWidth="1.6" />
          <path d="M5.25 8h5.5" stroke="var(--person)" strokeWidth="1.8" strokeLinecap="round" />
        </>
      ) : null}
      {status === "done" ? (
        <>
          <circle cx="8" cy="8" r="6.75" fill="var(--person)" />
          <path d="m5.25 8.2 1.85 1.85 3.65-3.8" fill="none" stroke="var(--person-on)" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </>
      ) : null}
      {status === "cancelled" ? (
        <>
          <circle cx="8" cy="8" r="6" fill="none" stroke="var(--ink-4)" strokeWidth="1.6" />
          <path d="m5.5 10.5 5-5" stroke="var(--ink-4)" strokeWidth="1.6" strokeLinecap="round" />
        </>
      ) : null}
    </svg>
  );
}

/** Rising bars for low to high; urgent is a filled square that can't be missed. */
export function PriorityIcon({ priority, size = 16, className }: { priority: TaskPriority; size?: number; className?: string }) {
  if (priority === "urgent") {
    return (
      <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" focusable="false" className={cn("shrink-0", className)}>
        <rect x="1.5" y="1.5" width="13" height="13" rx="3.5" fill="var(--tomato)" />
        <path d="M8 4.6v4.1" stroke="var(--tomato-on)" strokeWidth="1.9" strokeLinecap="round" />
        <circle cx="8" cy="11.2" r="1.05" fill="var(--tomato-on)" />
      </svg>
    );
  }
  const level = { none: 0, low: 1, medium: 2, high: 3 }[priority];
  return (
    <svg viewBox="0 0 16 16" width={size} height={size} aria-hidden="true" focusable="false" className={cn("shrink-0", className)}>
      {[0, 1, 2].map((bar) => (
        <rect
          key={bar}
          x={2 + bar * 4.5}
          y={11 - bar * 3.5}
          width="3"
          height={3 + bar * 3.5}
          rx="1"
          fill={bar < level ? "var(--ink-2)" : "var(--line-2)"}
        />
      ))}
    </svg>
  );
}
