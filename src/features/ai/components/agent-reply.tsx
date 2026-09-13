"use client";

import { useState } from "react";
import { toast } from "sonner";

import { IconChevronDown, IconStop, IconWarning } from "@/components/ui/icons";
import { isRunLive } from "@/features/workspace/store/helpers";
import { useWorkspace } from "@/features/workspace/store/workspace-provider";
import { getErrorMessage } from "@/lib/errors";
import { cn, pluralize } from "@/lib/utils";
import type { AgentRunStep, Message } from "@/types/domain";

import { cancelAgentRun } from "../api";
import { formatCredits } from "../credits";
import { RichText } from "../lib/rich-text";
import { findModel } from "../models";

/** The reply as it stands: live text and steps while streaming, the saved message once finished. */
function useAgentReply(message: Message) {
  const stream = useWorkspace((state) => state.agentStreams[message.id]);
  const live = isRunLive(message);
  const run = message.run;
  return {
    run,
    live,
    text: live ? (stream?.text ?? "") : message.body,
    steps: live && stream && stream.steps.length > 0 ? stream.steps : (run?.steps ?? []),
  };
}

function WorkingBars() {
  return (
    <span className="flex h-3 items-end gap-[2px]" aria-hidden="true">
      <span className="agent-bar h-3 w-[3px] rounded-full bg-person" />
      <span className="agent-bar h-3 w-[3px] rounded-full bg-person" />
      <span className="agent-bar h-3 w-[3px] rounded-full bg-person" />
    </span>
  );
}

const STEP_MARK: Record<AgentRunStep["kind"], string> = {
  read: "rounded-full",
  tool: "rounded-[2px]",
  web: "rotate-45 rounded-[1px]",
  note: "rounded-full opacity-50",
};

function StepList({ steps, className }: { steps: AgentRunStep[]; className?: string }) {
  return (
    <ol className={cn("flex flex-col gap-1", className)}>
      {steps.map((step, index) => (
        <li key={`${index}-${step.label}`} className="flex items-center gap-2 text-[12.5px] text-ink-3">
          <span className={cn("size-1.5 shrink-0 bg-ink-4", STEP_MARK[step.kind])} aria-hidden="true" />
          <span className="truncate">{step.label}</span>
        </li>
      ))}
    </ol>
  );
}

export function AgentReplyBody({ message }: { message: Message }) {
  const { run, live, text, steps } = useAgentReply(message);

  if (live && !text) {
    const earlier = steps.slice(-4, -1);
    const current = steps.at(-1)?.label ?? "Thinking";
    return (
      <div className="flex min-w-[220px] flex-col gap-1.5 px-3.5 py-2.5" aria-live="polite">
        {earlier.length > 0 ? <StepList steps={earlier} /> : null}
        <p className="flex animate-fade-in items-center gap-2 text-[13.5px] font-medium text-ink-2" key={current}>
          <WorkingBars />
          {current}…
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 px-3.5 py-2.5">
      {text ? (
        <RichText text={text} trailing={live ? <span className="agent-caret" aria-hidden="true" /> : null} />
      ) : (
        <p className="text-[14px] italic text-ink-3">
          {run?.status === "failed" ? "Couldn’t reply." : run?.status === "cancelled" ? "Stopped before replying." : "No reply."}
        </p>
      )}
      {run?.status === "failed" && run.error ? (
        <p className="flex items-start gap-1.5 text-[13px] leading-snug text-danger">
          <IconWarning size={15} className="mt-px shrink-0" />
          {run.error}
        </p>
      ) : null}
    </div>
  );
}

export function AgentReplyFooter({ message }: { message: Message }) {
  const meId = useWorkspace((state) => state.me.id);
  const myRole = useWorkspace((state) => state.myRole);
  const { run, live, steps } = useAgentReply(message);
  const [showSteps, setShowSteps] = useState(false);
  const [stopping, setStopping] = useState(false);

  if (!run) return null;
  const model = findModel(run.model);
  const canStop = live && (run.requestedBy === meId || myRole !== "member");

  async function stop() {
    if (!run) return;
    setStopping(true);
    try {
      const stopped = await cancelAgentRun(run.runId);
      if (!stopped) {
        setStopping(false);
        toast("That reply already finished.");
      }
    } catch (error) {
      setStopping(false);
      toast.error(getErrorMessage(error, "Couldn't stop the reply."));
    }
  }

  const parts: React.ReactNode[] = [];
  if (model) parts.push(<span key="model">{model.label}</span>);
  if (live) parts.push(<span key="live">{run.status === "working" ? "writing" : "working"}</span>);
  if (!live && run.status === "cancelled") parts.push(<span key="stopped">stopped</span>);
  if (!live && run.credits !== null) {
    parts.push(
      <span key="credits" className="tabular-nums">
        {formatCredits(run.credits)} {run.credits === 1 ? "credit" : "credits"}
      </span>,
    );
  }
  if (!live && steps.length > 0) {
    parts.push(
      <button
        key="steps"
        type="button"
        onClick={() => setShowSteps((open) => !open)}
        aria-expanded={showSteps}
        className="inline-flex items-center gap-0.5 underline-offset-2 hover:text-ink hover:underline"
      >
        {pluralize(steps.length, "step")}
        <IconChevronDown size={12} className={cn("transition-transform duration-150", showSteps && "rotate-180")} />
      </button>,
    );
  }

  return (
    <div className="mt-1 flex flex-col items-start gap-1.5 px-1">
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 font-mono text-[10.5px] text-ink-3">
        {parts.map((part, index) => (
          <span key={index} className="inline-flex items-center gap-1.5">
            {index > 0 ? <span aria-hidden="true">·</span> : null}
            {part}
          </span>
        ))}
        {canStop ? (
          <button
            type="button"
            onClick={() => void stop()}
            disabled={stopping}
            className="ml-1.5 inline-flex h-6 items-center gap-1 rounded-full border border-line-2 bg-surface px-2 font-sans text-[11.5px] font-medium text-ink-2 transition-colors hover:border-ink-4 hover:text-ink disabled:opacity-60"
          >
            <IconStop size={11} />
            {stopping ? "Stopping…" : "Stop"}
          </button>
        ) : null}
      </div>
      {showSteps && !live ? <StepList steps={steps} className="animate-fade-in rounded-2xl border border-line bg-surface px-3 py-2" /> : null}
    </div>
  );
}
