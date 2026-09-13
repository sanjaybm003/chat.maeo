import { cn } from "@/lib/utils";

/**
 * The mark: a speech bubble with two voices in it. The bubble takes the theme's
 * ink, the voices keep their color in light and dark.
 */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 28 28" width={size} height={size} className={cn("shrink-0", className)} aria-hidden="true">
      <path
        d="M8.5 1h11A7.5 7.5 0 0 1 27 8.5v11a7.5 7.5 0 0 1-7.5 7.5H3.25A2.25 2.25 0 0 1 1 24.75V8.5A7.5 7.5 0 0 1 8.5 1Z"
        style={{ fill: "var(--ink)" }}
      />
      <circle cx="10" cy="14" r="4" style={{ fill: "var(--tomato)" }} />
      <circle cx="18.5" cy="14" r="4" style={{ fill: "var(--saffron)" }} />
    </svg>
  );
}

export function Logo({ className, size = 28 }: { className?: string; size?: number }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark size={size} />
      <span
        className="font-display font-bold leading-none tracking-[-0.045em] text-ink"
        style={{ fontSize: Math.round(size * 0.72) }}
      >
        maeosan
      </span>
    </span>
  );
}
