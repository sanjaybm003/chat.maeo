"use client";

import Link from "next/link";

import { useWorkspace } from "@/features/workspace/store/workspace-provider";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import type { CreditAccount } from "@/types/domain";

import { formatCredits } from "../credits";

export const LOW_CREDIT_SHARE = 0.1;

/** The allowance the meter is measured against: what was granted, or more if adjustments added some. */
export function creditTotal(credits: CreditAccount) {
  return Math.max(credits.lifetimeGranted, credits.balance + credits.reserved, 1);
}

/** A slim balance meter for the sidebar; opens the full usage page. */
export function CreditsMeter({ className }: { className?: string }) {
  const credits = useWorkspace((state) => state.credits);
  const slug = useWorkspace((state) => state.workspace.slug);
  if (!credits) return null;

  const total = creditTotal(credits);
  const share = Math.min(1, Math.max(0, credits.balance / total));
  const low = share < LOW_CREDIT_SHARE;

  return (
    <Link
      href={routes.settings(slug, "ai")}
      className={cn("group flex flex-col gap-1.5 rounded-xl px-2.5 py-2 transition-colors hover:bg-paper", className)}
    >
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] text-ink-3 transition-colors group-hover:text-ink-2">AI credits</span>
        <span className="font-mono text-[11.5px] tabular-nums text-ink-2">
          {low ? <span className="mr-1.5 font-sans text-[11.5px] font-medium text-danger">Low</span> : null}
          {formatCredits(credits.balance)}
        </span>
      </span>
      <span
        role="meter"
        aria-label="AI credits left"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={credits.balance}
        className="block h-1 overflow-hidden rounded-full bg-meter-track"
      >
        <span className="block h-full rounded-full bg-meter transition-[width] duration-500" style={{ width: `${share * 100}%` }} />
      </span>
    </Link>
  );
}
