import { cn } from "@/lib/utils";

/** For an app that posted through a webhook: its initial on a quiet square, so it never reads as a person. */
export function AppAvatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      role="img"
      aria-label={name}
      className={cn(
        "flex size-9 shrink-0 select-none items-center justify-center rounded-[11px] border border-line-2 bg-paper-2 font-display text-[13px] font-semibold text-ink-2",
        className,
      )}
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function AppTag() {
  return (
    <span className="inline-flex h-[17px] items-center rounded-[5px] border border-line-2 px-1 font-mono text-[9.5px] font-medium uppercase leading-none tracking-[0.1em] text-ink-2">
      App
    </span>
  );
}
