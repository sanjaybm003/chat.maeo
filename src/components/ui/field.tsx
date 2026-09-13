import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

interface FieldProps {
  label: ReactNode;
  htmlFor: string;
  error?: string | null;
  hint?: ReactNode;
  aside?: ReactNode;
  className?: string;
  children: ReactNode;
}

export function Field({ label, htmlFor, error, hint, aside, className, children }: FieldProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={htmlFor} className="text-[13px] font-medium text-ink-2">
          {label}
        </label>
        {aside}
      </div>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-[13px] text-ink-3">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <div role="alert" className="animate-rise rounded-xl border border-danger/30 bg-danger-tint px-3.5 py-2.5 text-sm text-danger">
      {message}
    </div>
  );
}

export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p className={cn("font-mono text-[11px] font-medium uppercase tracking-[0.12em] text-ink-3", className)}>
      {children}
    </p>
  );
}
