"use client";

import { useState, type ComponentProps } from "react";

import { IconEye, IconEyeOff } from "@/components/ui/icons";
import { inputStyles } from "@/components/ui/input";
import { cn } from "@/lib/utils";

import { passwordScore } from "../schemas";

export function PasswordInput({ className, ...props }: Omit<ComponentProps<"input">, "type">) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input
        type={visible ? "text" : "password"}
        className={cn(inputStyles, "h-11 pr-11", className)}
        spellCheck={false}
        autoCapitalize="none"
        {...props}
      />
      <button
        type="button"
        onClick={() => setVisible((value) => !value)}
        className="absolute right-1.5 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-lg text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink"
        aria-label={visible ? "Hide password" : "Show password"}
        aria-pressed={visible}
      >
        {visible ? <IconEyeOff size={17} /> : <IconEye size={17} />}
      </button>
    </div>
  );
}

const LABELS = ["Too short", "Weak", "Okay", "Strong", "Excellent"];
const COLORS = ["var(--line-2)", "var(--tomato)", "var(--saffron)", "var(--grass)", "var(--grass)"];

export function PasswordMeter({ password }: { password: string }) {
  const score = passwordScore(password);
  if (!password) return null;

  return (
    <div className="flex items-center gap-3" aria-live="polite">
      <div className="grid flex-1 grid-cols-4 gap-1">
        {[1, 2, 3, 4].map((step) => (
          <span
            key={step}
            className="h-1 rounded-full transition-colors duration-300"
            style={{ backgroundColor: score >= step ? COLORS[score] : "var(--line)" }}
          />
        ))}
      </div>
      <span className="w-16 text-right font-mono text-[11px] text-ink-3">{LABELS[score]}</span>
    </div>
  );
}
