import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

const STEPS = [
  { label: "About you", color: "tomato", shape: "circle" },
  { label: "Your workspace", color: "cobalt", shape: "half" },
  { label: "Your people", color: "saffron", shape: "square" },
] as const;

type Step = 1 | 2 | 3;

function StepShape({ shape, color }: { shape: (typeof STEPS)[number]["shape"]; color: string }) {
  const style = { fill: color };
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" className="shrink-0">
      {shape === "circle" ? <circle cx="12" cy="12" r="11" style={style} /> : null}
      {shape === "half" ? <path d="M1 18a11 11 0 0 1 22 0Z" style={style} /> : null}
      {shape === "square" ? <rect x="2" y="2" width="20" height="20" rx="5" style={style} /> : null}
    </svg>
  );
}

function StepRail({ current }: { current: Step }) {
  return (
    <ol className="flex flex-wrap gap-x-6 gap-y-3 lg:flex-col lg:gap-6">
      {STEPS.map((step, index) => {
        const number = (index + 1) as Step;
        const upcoming = number > current;
        const active = number === current;
        return (
          <li
            key={step.label}
            aria-current={active ? "step" : undefined}
            className={cn("flex items-center gap-3", !active && "max-lg:hidden")}
          >
            <StepShape shape={step.shape} color={upcoming ? "var(--line-2)" : `var(--${step.color})`} />
            <span className="flex flex-col">
              <span className="font-mono text-[11px] leading-none text-ink-3">
                0{number}
                <span className="lg:hidden"> / 03</span>
              </span>
              <span className={cn("mt-1 text-sm font-medium", upcoming ? "text-ink-4" : "text-ink")}>{step.label}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

interface OnboardingFrameProps {
  step: Step;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}

export function OnboardingFrame({ step, title, description, children }: OnboardingFrameProps) {
  return (
    <div className="mx-auto grid w-full max-w-[1040px] gap-10 pt-2 lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-24 lg:pt-14">
      <aside className="lg:sticky lg:top-14 lg:self-start">
        <StepRail current={step} />
      </aside>
      <section className="w-full max-w-[560px] animate-rise">
        <h1 className="font-display text-[42px] font-semibold leading-[0.98] tracking-[-0.04em] text-ink sm:text-[54px]">
          {title}
        </h1>
        {description ? <p className="mt-4 max-w-[470px] text-base leading-relaxed text-ink-3">{description}</p> : null}
        <div className="mt-10">{children}</div>
      </section>
    </div>
  );
}
