"use client";

import Link from "next/link";
import { Popover } from "radix-ui";
import { useMemo, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { IconArrowRight, IconPlus, IconTasks } from "@/components/ui/icons";
import { useWorkspace } from "@/features/workspace/store/workspace-provider";
import { useHydrated } from "@/hooks/use-hydrated";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import type { Conversation, Task } from "@/types/domain";

import { useTaskActions } from "../hooks/use-task-actions";
import { isoDate } from "../lib/dates";
import { isOpenTask, summarizeWork, taskKey, workUpdate } from "../lib/task-meta";
import { DueLabel, TaskAssigneeAvatar } from "./task-fields";
import { TaskStatusIcon } from "./task-marks";

const startOfToday = () => {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return now.toISOString();
};

/**
 * Your work without leaving the chat: what's waiting on you, what came from
 * this chat, what your agents are doing, and a one-tap update to post here.
 */
export function MyWork({ conversation }: { conversation: Conversation }) {
  const tasks = useWorkspace((state) => state.tasks);
  const tasksReady = useWorkspace((state) => state.tasksReady);
  const meId = useWorkspace((state) => state.me.id);
  const slug = useWorkspace((state) => state.workspace.slug);
  const openDialog = useWorkspace((state) => state.openDialog);
  const insertIntoComposer = useWorkspace((state) => state.insertIntoComposer);
  const hydrated = useHydrated();
  const [open, setOpen] = useState(false);

  const today = hydrated ? isoDate(new Date()) : null;
  const work = useMemo(
    () => summarizeWork(Object.values(tasks), meId, { conversationId: conversation.id, today, since: hydrated ? startOfToday() : null }),
    [tasks, meId, conversation.id, today, hydrated],
  );

  if (!tasksReady) return null;

  const count = work.mine.length;
  const summary =
    count === 0
      ? "Nothing is waiting on you."
      : [`${count} open`, work.dueToday ? `${work.dueToday} due today` : null, work.late ? `${work.late} late` : null].filter(Boolean).join(" · ");

  function openTask(task: Task) {
    setOpen(false);
    openDialog({ name: "task", taskId: task.id });
  }

  function shareUpdate() {
    setOpen(false);
    insertIntoComposer(conversation.id, workUpdate(work, today));
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={count > 0 ? `My work, ${summary}` : "My work"}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12.5px] text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink data-[state=open]:bg-paper-2 data-[state=open]:text-ink"
        >
          <IconTasks size={18} />
          <span className="hidden lg:inline">My work</span>
          {count > 0 ? (
            <span
              className={cn(
                "min-w-[18px] rounded-full px-1.5 text-center font-mono text-[10.5px] leading-[18px] tabular-nums",
                work.late > 0 ? "bg-danger-tint text-danger" : "bg-paper-3 text-ink-2",
              )}
            >
              {count}
            </span>
          ) : null}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          collisionPadding={12}
          className="z-50 flex max-h-[min(560px,80vh)] w-[min(380px,calc(100vw-24px))] flex-col overflow-hidden rounded-[22px] border border-line bg-surface shadow-pop outline-none data-[state=open]:animate-pop-in"
        >
          <div className="flex items-start justify-between gap-3 border-b border-line px-4 pb-3 pt-3.5">
            <div className="min-w-0">
              <p className="font-display text-[17px] font-semibold tracking-[-0.01em] text-ink">My work</p>
              <p className={cn("mt-0.5 text-[12.5px]", work.late > 0 ? "text-danger" : "text-ink-3")}>{summary}</p>
            </div>
            <Link
              href={routes.tasks(slug)}
              onClick={() => setOpen(false)}
              className="inline-flex h-8 shrink-0 items-center gap-1 rounded-full px-2.5 text-[12.5px] text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink"
            >
              All tasks
              <IconArrowRight size={14} />
            </Link>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
            <WorkSection title="Waiting on you" empty="Nothing assigned to you. Nice.">
              {work.mine.slice(0, 6).map((task) => (
                <WorkLine key={task.id} task={task} onOpen={() => openTask(task)} />
              ))}
            </WorkSection>
            {work.mine.length > 6 ? <p className="px-3 pb-1 text-[12px] text-ink-3">{work.mine.length - 6} more in Tasks</p> : null}

            {work.here.length > 0 ? (
              <WorkSection title="From this chat">
                {work.here.slice(0, 4).map((task) => (
                  <WorkLine key={task.id} task={task} onOpen={() => openTask(task)} />
                ))}
              </WorkSection>
            ) : null}

            {work.withAgents.length > 0 ? (
              <WorkSection title="Your agents are on">
                {work.withAgents.slice(0, 4).map((task) => (
                  <WorkLine key={task.id} task={task} onOpen={() => openTask(task)} />
                ))}
              </WorkSection>
            ) : null}

            {work.finished.length > 0 ? (
              <p className="px-3 pb-1 pt-2 text-[12px] text-ink-3">
                {work.finished.length} finished today: {work.finished.slice(0, 2).map((task) => taskKey(task.number)).join(", ")}
                {work.finished.length > 2 ? "…" : ""}
              </p>
            ) : null}
          </div>

          <div className="flex items-center gap-2 border-t border-line px-3 py-2.5">
            <Button size="sm" variant="secondary" className="flex-1" onClick={shareUpdate}>
              Share my update here
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setOpen(false);
                openDialog({ name: "task", draft: {} });
              }}
            >
              <IconPlus size={15} />
              New task
            </Button>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

function WorkSection({ title, empty, children }: { title: string; empty?: string; children: ReactNode[] }) {
  return (
    <section className="pb-1">
      <p className="px-2.5 pb-1 pt-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-4">{title}</p>
      {children.length > 0 ? <ul className="flex flex-col">{children}</ul> : <p className="px-2.5 pb-2 text-[13px] text-ink-3">{empty}</p>}
    </section>
  );
}

function WorkLine({ task, onOpen }: { task: Task; onOpen: () => void }) {
  const actions = useTaskActions();
  const open = isOpenTask(task);
  const key = taskKey(task.number);

  return (
    <li className="flex items-center gap-1.5 rounded-xl px-1 transition-colors hover:bg-paper-2 [--avatar-ring:var(--surface)]">
      <button
        type="button"
        onClick={() => void actions.update(task, { status: open ? "done" : "todo" })}
        aria-label={open ? `Mark ${key} done` : `Reopen ${key}`}
        className="flex size-8 shrink-0 items-center justify-center rounded-full"
      >
        <TaskStatusIcon status={task.status} size={16} className="transition-transform duration-200 active:scale-90" />
      </button>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 py-1.5 text-left">
        <span className={cn("block truncate text-[13.5px] leading-snug text-ink", !open && "text-ink-3 line-through decoration-ink-4")}>
          {task.title}
        </span>
        <span className="mt-0.5 flex items-center gap-2 text-[11.5px] text-ink-3">
          <span className="font-mono">{key}</span>
          {task.dueOn ? <DueLabel dueOn={task.dueOn} done={!open} /> : null}
        </span>
      </button>
      <span className="shrink-0 pr-1">
        <TaskAssigneeAvatar task={task} />
      </span>
    </li>
  );
}
