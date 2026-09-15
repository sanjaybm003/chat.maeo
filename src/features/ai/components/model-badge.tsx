"use client";

import { Popover } from "radix-ui";

import { pluralize } from "@/lib/utils";
import type { AgentRun } from "@/types/domain";

import { formatCredits } from "../credits";
import { findModel, STRENGTH_LABELS, TIER_LABELS, type ModelSpeed } from "../models";

const HOW: Record<NonNullable<AgentRun["route"]>["mode"], string> = {
  auto: "Picked for this message",
  fixed: "Set for this agent",
  override: "Chosen by the person asking",
};

const SPEED: Record<ModelSpeed, string> = {
  3: "Starts answering fast",
  2: "Steady",
  1: "Thinks before answering",
};

const compactTokens = (tokens: number) => (tokens >= 1_000_000 ? `${tokens / 1_000_000}M` : `${Math.round(tokens / 1000)}K`);

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5 rounded-xl bg-paper px-2.5 py-2">
      <dt className="text-[11px] text-ink-3">{label}</dt>
      <dd className="font-mono text-[12.5px] tabular-nums text-ink">{value}</dd>
    </div>
  );
}

/** Which model wrote a reply; tapped, why it was chosen and what the reply took. */
export function ModelBadge({ run, live, sourceCount }: { run: AgentRun; live: boolean; sourceCount: number }) {
  const model = findModel(run.model);
  const label = model?.label ?? run.model ?? "Model";
  const reason = run.route?.reason?.replace(/^Auto picked /, "Picked ");

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={`Written with ${label}. Show details`}
          className="inline-flex items-center rounded-full underline-offset-2 transition-colors hover:text-ink hover:underline data-[state=open]:text-ink"
        >
          {run.route?.mode === "auto" ? `Auto · ${label}` : label}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side="top"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className="z-50 w-[300px] animate-pop-in rounded-[20px] border border-line bg-surface p-4 font-sans shadow-pop"
        >
          <p className="font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">{run.route ? HOW[run.route.mode] : "Model"}</p>
          <p className="mt-1.5 text-[16px] font-semibold leading-tight text-ink">{label}</p>
          {model ? (
            <>
              <p className="mt-0.5 text-[12.5px] text-ink-3">
                {model.maker} · {TIER_LABELS[model.tier]} · {SPEED[model.speed]}
              </p>
              <p className="mt-2 text-[13px] leading-snug text-ink-2">{model.summary}</p>
              {model.strengths.length > 0 ? (
                <div className="mt-2.5 flex flex-wrap gap-1">
                  {model.strengths.map((strength) => (
                    <span key={strength} className="rounded-full border border-line px-2 py-0.5 font-mono text-[10.5px] text-ink-2">
                      {STRENGTH_LABELS[strength]}
                    </span>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}
          {reason ? <p className="mt-3 border-t border-line pt-3 text-[12.5px] leading-snug text-ink-2">{reason}.</p> : null}
          {!live ? (
            <dl className="mt-3 grid grid-cols-3 gap-1.5">
              <Stat label="Credits" value={run.credits === null ? "—" : formatCredits(run.credits)} />
              <Stat label="Steps" value={String(run.steps.length)} />
              <Stat label="Sources" value={String(sourceCount)} />
            </dl>
          ) : null}
          {model ? (
            <p className="mt-2.5 font-mono text-[10.5px] text-ink-3">
              Reads up to {compactTokens(model.contextWindow)} tokens · {pluralize(Math.round(model.inputPrice * 1000) / 1000, "dollar")} per million in
            </p>
          ) : null}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
