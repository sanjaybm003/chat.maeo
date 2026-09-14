"use client";

import { Fragment, type ReactNode } from "react";

import { IconChevronDown } from "@/components/ui/icons";
import { Menu, MenuContent, MenuLabel, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { cn } from "@/lib/utils";

import { typicalReplyCredits } from "../credits";
import { TIER_LABELS, type AiModel, type ModelTier } from "../models";

export const AUTO_MODEL = "auto";

const TIERS: readonly ModelTier[] = ["fast", "balanced", "deep"];

interface ModelMenuProps {
  /** "auto" or a model id. */
  value: string;
  onChange: (value: string) => void;
  available: readonly AiModel[];
  /** What Auto would pick right now, shown under it. */
  autoHint?: string | null;
  label: ReactNode;
  className?: string;
  align?: "start" | "center" | "end";
}

/** Auto, or one specific model with its typical price per reply. */
export function ModelMenu({ value, onChange, available, autoHint, label, className, align = "start" }: ModelMenuProps) {
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex min-w-0 items-center gap-1 rounded-full transition-colors hover:text-ink data-[state=open]:text-ink",
            className,
          )}
        >
          <span className="truncate">{label}</span>
          <IconChevronDown size={12} className="shrink-0" />
        </button>
      </MenuTrigger>
      <MenuContent align={align} className="max-h-[360px] min-w-[260px] overflow-y-auto">
        <MenuRadioGroup value={value} onValueChange={onChange}>
          <MenuRadioItem value={AUTO_MODEL}>
            <span className="flex flex-col">
              <span>Auto</span>
              <span className="text-[12px] text-ink-3">{autoHint ? `Would use ${autoHint} here` : "Picks a model for each message"}</span>
            </span>
          </MenuRadioItem>
          {TIERS.map((tier) => {
            const models = available.filter((model) => model.tier === tier);
            if (models.length === 0) return null;
            return (
              <Fragment key={tier}>
                <MenuSeparator />
                <MenuLabel>{TIER_LABELS[tier]}</MenuLabel>
                {models.map((model) => (
                  <MenuRadioItem key={model.id} value={model.id}>
                    <span className="flex w-full items-baseline justify-between gap-4">
                      <span>{model.label}</span>
                      <span className="font-mono text-[11px] text-ink-3">≈ {typicalReplyCredits(model)}</span>
                    </span>
                  </MenuRadioItem>
                ))}
              </Fragment>
            );
          })}
        </MenuRadioGroup>
      </MenuContent>
    </Menu>
  );
}
