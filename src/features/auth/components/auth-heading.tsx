import type { ReactNode } from "react";

export function AuthHeading({ eyebrow, title, children }: { eyebrow?: string; title: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-8">
      {eyebrow ? (
        <p className="mb-4 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">{eyebrow}</p>
      ) : null}
      <h1 className="font-display text-[40px] font-semibold leading-[1.02] tracking-[-0.035em] text-ink sm:text-[44px]">
        {title}
      </h1>
      {children ? <p className="mt-3 text-[15px] leading-relaxed text-ink-3">{children}</p> : null}
    </header>
  );
}
