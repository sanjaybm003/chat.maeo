import { cn } from "@/lib/utils";

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width={size}
      height={size}
      className={cn("animate-spin", className)}
      role="status"
      aria-label="Loading"
    >
      <circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="2.2" />
      <path d="M17.5 10A7.5 7.5 0 0 0 10 2.5" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
    </svg>
  );
}
