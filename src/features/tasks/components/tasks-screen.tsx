"use client";

import Link from "next/link";
import { useMemo, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/field";
import { IconArrowLeft, IconChat, IconPlus, IconSearch, IconWarning } from "@/components/ui/icons";
import { Kbd } from "@/components/ui/kbd";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { useWorkspace } from "@/features/workspace/store/workspace-provider";
import { useHydrated } from "@/hooks/use-hydrated";
import { getErrorMessage } from "@/lib/errors";
import { usePreferences, type TaskLayout } from "@/lib/preferences";
import { routes } from "@/lib/routes";
import { cn, firstNameOf, nameOf } from "@/lib/utils";
import type { Task } from "@/types/domain";

import { useTaskActions } from "../hooks/use-task-actions";
import { isoDate } from "../lib/dates";
import { parseQuickTask } from "../lib/quick-task";
import {
  describeDue,
  groupByStatus,
  inView,
  isOpenTask,
  matchesTaskQuery,
  TASK_PRIORITY_META,
  TASK_STATUS_META,
  TASK_VIEWS,
  taskKey,
  type TaskView,
} from "../lib/task-meta";
import { TaskBoard } from "./task-board";
import { AssigneePicker, DueLabel, DuePicker, PriorityMenu, StatusMenu, TaskAssigneeAvatar } from "./task-fields";
import { PriorityIcon, TaskStatusIcon } from "./task-marks";

export function TasksScreen() {
  const workspace = useWorkspace((state) => state.workspace);
  const meId = useWorkspace((state) => state.me.id);
  const members = useWorkspace((state) => state.members);
  const agents = useWorkspace((state) => state.agents);
  const tasks = useWorkspace((state) => state.tasks);
  const tasksReady = useWorkspace((state) => state.tasksReady);
  const openDialog = useWorkspace((state) => state.openDialog);
  const hydrated = useHydrated();
  const [view, setView] = useState<TaskView>("mine");
  const [query, setQuery] = useState("");
  const [showFinished, setShowFinished] = useState(false);
  const [preferences, updatePreferences] = usePreferences();
  const layout = preferences.taskLayout;

  const all = useMemo(() => Object.values(tasks), [tasks]);
  const today = hydrated ? isoDate(new Date()) : null;
  const mineOpen = all.filter((task) => task.assigneeId === meId && isOpenTask(task));
  const late = today ? mineOpen.filter((task) => task.dueOn !== null && task.dueOn < today).length : 0;
  const dueToday = today ? mineOpen.filter((task) => task.dueOn === today).length : 0;

  const assigneeName = (task: Task) =>
    task.assigneeId ? nameOf(members[task.assigneeId]) : task.agentId ? (agents[task.agentId]?.name ?? null) : null;
  const inThisView = all.filter((task) => inView(task, view, meId));
  const finished = inThisView.filter((task) => !isOpenTask(task)).length;
  const groups = groupByStatus(
    inThisView.filter((task) => (showFinished || isOpenTask(task)) && matchesTaskQuery(task, query, assigneeName(task))),
  );
  // The board always has a Done column, so it takes finished work regardless of the switch.
  const boardTasks = inThisView.filter((task) => task.status !== "cancelled" && matchesTaskQuery(task, query, assigneeName(task)));
  const openIn = (option: TaskView) => all.filter((task) => inView(task, option, meId) && isOpenTask(task)).length;

  const summary =
    mineOpen.length === 0
      ? "Nothing is waiting on you."
      : [`${mineOpen.length} open for you`, dueToday ? `${dueToday} due today` : null, late ? `${late} late` : null].filter(Boolean).join(" · ");

  let rowIndex = 0;

  return (
    <div className="h-full overflow-y-auto">
      <div className={cn("mx-auto w-full px-5 pb-24 pt-5 sm:px-10 sm:pt-10", layout === "board" ? "max-w-[1240px]" : "max-w-[980px]")}>
        <Link
          href={routes.workspace(workspace.slug)}
          className="mb-4 inline-flex size-9 items-center justify-center rounded-full text-ink-2 hover:bg-paper-2 md:hidden"
          aria-label="Back to chats"
        >
          <IconArrowLeft />
        </Link>

        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">{workspace.name}</p>
            <h1 className="mt-2 font-display text-[44px] font-semibold leading-none tracking-[-0.04em]">Tasks</h1>
            <p className="mt-3 max-w-[560px] text-[15px] leading-relaxed text-ink-3">
              Give work to a teammate or an agent, from here or straight from a chat.{" "}
              <span className={cn(late > 0 ? "text-danger" : "text-ink-2")}>{hydrated ? summary : ""}</span>
            </p>
          </div>
          {tasksReady ? (
            <Button onClick={() => openDialog({ name: "task", draft: {} })}>
              <IconPlus size={16} />
              New task
              <Kbd className="ml-1 border-transparent bg-[color-mix(in_srgb,var(--paper)_18%,transparent)] text-paper">T</Kbd>
            </Button>
          ) : null}
        </div>

        {!tasksReady ? (
          <div className="mt-8 flex gap-3 rounded-[20px] border border-line bg-surface px-5 py-4">
            <IconWarning size={18} className="mt-0.5 shrink-0 text-ink-2" />
            <div>
              <p className="text-[14.5px] font-semibold text-ink">Tasks aren’t switched on yet</p>
              <p className="mt-1 text-[13.5px] leading-relaxed text-ink-2">They’ll appear here once the latest database update is applied.</p>
            </div>
          </div>
        ) : (
          <>
            <QuickAdd view={view} className="mt-9" />

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <Segmented<TaskView>
                label="Which tasks"
                size="sm"
                value={view}
                onChange={setView}
                options={TASK_VIEWS.map((option) => {
                  const count = openIn(option.value);
                  return { value: option.value, label: count > 0 ? `${option.label} ${count}` : option.label };
                })}
              />
              <Segmented<TaskLayout>
                label="Show tasks as"
                size="sm"
                value={layout}
                onChange={(taskLayout) => updatePreferences({ taskLayout })}
                options={[
                  { value: "list", label: "List" },
                  { value: "board", label: "Board" },
                ]}
              />
              <div className="relative ml-auto min-w-[180px] flex-1 sm:max-w-[260px]">
                <IconSearch size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Find a task"
                  aria-label="Find a task"
                  className="h-9 w-full rounded-full border border-line-2 bg-surface pl-8 pr-3 text-[13.5px] text-ink outline-none transition-colors placeholder:text-ink-4 focus:border-ink-4"
                />
              </div>
              {layout === "list" ? (
                <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-2">
                  <Switch checked={showFinished} onCheckedChange={setShowFinished} aria-label="Show finished tasks" />
                  Finished{finished > 0 ? ` ${finished}` : ""}
                </label>
              ) : null}
            </div>

            {layout === "board" ? (
              boardTasks.length === 0 && query.trim() ? (
                <div className="mt-6 rounded-[24px] border border-dashed border-line-2 px-6 py-14 text-center">
                  <p className="font-display text-xl font-semibold">No tasks match.</p>
                  <p className="mt-1 text-sm text-ink-3">Try other words, a number like T-12, or another view.</p>
                </div>
              ) : (
                <div className="mt-6">
                  <TaskBoard tasks={boardTasks} />
                </div>
              )
            ) : groups.length === 0 ? (
              <div className="mt-6 rounded-[24px] border border-dashed border-line-2 px-6 py-14 text-center">
                <p className="font-display text-xl font-semibold">{query.trim() ? "No tasks match." : EMPTY[view].title}</p>
                <p className="mt-1 text-sm text-ink-3">{query.trim() ? "Try other words, a number like T-12, or another view." : EMPTY[view].body}</p>
              </div>
            ) : (
              groups.map((group) => (
                <section key={group.status} className="mt-8">
                  <SectionLabel className="mb-2 flex items-center gap-2 px-3">
                    <TaskStatusIcon status={group.status} size={13} />
                    {TASK_STATUS_META[group.status].label}
                    <span className="text-ink-4">{group.tasks.length}</span>
                  </SectionLabel>
                  <ul className="flex flex-col">
                    {group.tasks.map((task) => (
                      <TaskRow key={task.id} task={task} index={rowIndex++} />
                    ))}
                  </ul>
                </section>
              ))
            )}
          </>
        )}
      </div>
    </div>
  );
}

const EMPTY: Record<TaskView, { title: string; body: string }> = {
  mine: { title: "Nothing assigned to you.", body: "Press T to add a task, or type /task in any chat." },
  created: { title: "You haven’t made any tasks yet.", body: "Add one above, or turn a message into a task from its menu." },
  agents: { title: "No agent has work yet.", body: "Assign a task to an agent and it can start on it in its chat with you." },
  all: { title: "No tasks in this workspace yet.", body: "Add the first one above." },
};

function QuickAdd({ view, className }: { view: TaskView; className?: string }) {
  const meId = useWorkspace((state) => state.me.id);
  const members = useWorkspace((state) => state.members);
  const agents = useWorkspace((state) => state.agents);
  const actions = useTaskActions();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);

  const directory = useMemo(() => ({ members: Object.values(members), agents: Object.values(agents) }), [members, agents]);
  const parsed = useMemo(() => parseQuickTask(text, directory), [text, directory]);
  const who = parsed.assignee
    ? parsed.assignee.kind === "agent"
      ? (agents[parsed.assignee.id]?.name ?? "an agent")
      : parsed.assignee.id === meId
        ? "you"
        : firstNameOf(members[parsed.assignee.id])
    : null;

  async function add() {
    if (!parsed.title || busy) return;
    setBusy(true);
    try {
      // On "Assigned to me", a task that names nobody is yours.
      const mine = view === "mine" && !parsed.assignee;
      const task = await actions.create({
        title: parsed.title.slice(0, 200),
        priority: parsed.priority ?? "none",
        dueOn: parsed.dueOn,
        assigneeId: parsed.assignee?.kind === "person" ? parsed.assignee.id : mine ? meId : null,
        agentId: parsed.assignee?.kind === "agent" ? parsed.assignee.id : null,
      });
      setText("");
      toast.success(`${taskKey(task.number)} added`, { description: task.title });
    } catch (error) {
      toast.error(getErrorMessage(error, "Couldn't add the task."));
    } finally {
      setBusy(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void add();
    } else if (event.key === "Escape") {
      setText("");
    }
  }

  const chips = [
    who ? `for ${who}` : null,
    parsed.dueOn ? `due ${describeDue(parsed.dueOn, isoDate(new Date())).label.toLowerCase()}` : null,
    parsed.priority ? TASK_PRIORITY_META[parsed.priority].label.toLowerCase() : null,
  ].filter(Boolean);

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-[20px] border border-line bg-surface px-4 transition-[border-color,box-shadow] duration-150",
        "focus-within:border-ink-4 focus-within:shadow-[0_0_0_4px_color-mix(in_srgb,var(--ink)_5%,transparent)]",
        className,
      )}
    >
      <IconPlus size={17} className="shrink-0 text-ink-3" />
      <input
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={handleKeyDown}
        maxLength={300}
        disabled={busy}
        placeholder="Add a task: “Send the invoice @sam friday !high”"
        aria-label="Add a task"
        className="h-13 min-w-0 flex-1 bg-transparent text-[15px] text-ink outline-none placeholder:text-ink-4"
      />
      {text.trim() ? (
        <span className="hidden shrink-0 font-mono text-[11px] text-ink-3 sm:inline">
          {parsed.unknownMention ? `@${parsed.unknownMention} isn’t here` : chips.length > 0 ? chips.join(" · ") : "enter to add"}
        </span>
      ) : null}
    </div>
  );
}

function TaskRow({ task, index }: { task: Task; index: number }) {
  const slug = useWorkspace((state) => state.workspace.slug);
  const actions = useTaskActions();
  const open = isOpenTask(task);

  return (
    <li
      className="group flex animate-rise items-center gap-2 rounded-2xl px-2 py-1.5 transition-colors hover:bg-surface sm:gap-3 sm:px-3"
      style={{ animationDelay: `${Math.min(index, 12) * 25}ms` }}
    >
      <StatusMenu value={task.status} onChange={(status) => void actions.update(task, { status })}>
        <button
          type="button"
          aria-label={`${TASK_STATUS_META[task.status].label}. Change status`}
          className="flex size-8 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-paper-2 data-[state=open]:bg-paper-2"
        >
          <TaskStatusIcon status={task.status} size={17} />
        </button>
      </StatusMenu>
      <span className="hidden w-12 shrink-0 font-mono text-[11.5px] text-ink-3 sm:block">{taskKey(task.number)}</span>
      <Link
        href={routes.task(slug, task.number)}
        className={cn(
          "min-w-0 flex-1 truncate py-1.5 text-[14.5px] text-ink underline-offset-2 hover:underline",
          !open && "text-ink-3 line-through decoration-ink-4",
        )}
      >
        {task.title}
      </Link>
      {task.conversationId ? <IconChat size={14} className="hidden shrink-0 text-ink-4 sm:block" aria-label="Shared in a chat" /> : null}
      <PriorityMenu value={task.priority} onChange={(priority) => void actions.update(task, { priority })} align="end">
        <button
          type="button"
          aria-label={`Priority: ${TASK_PRIORITY_META[task.priority].label}. Change`}
          className={cn(
            "flex size-8 shrink-0 items-center justify-center rounded-full transition-[background-color,opacity] hover:bg-paper-2 data-[state=open]:bg-paper-2 data-[state=open]:opacity-100",
            task.priority === "none" && "opacity-0 focus-visible:opacity-100 group-hover:opacity-100",
          )}
        >
          <PriorityIcon priority={task.priority} />
        </button>
      </PriorityMenu>
      <DuePicker value={task.dueOn} onChange={(dueOn) => void actions.update(task, { dueOn })} align="end">
        <button
          type="button"
          aria-label={task.dueOn ? "Change due date" : "Set a due date"}
          className={cn(
            "hidden h-8 w-[92px] shrink-0 items-center justify-end rounded-full px-2 text-[12.5px] transition-[background-color,opacity] hover:bg-paper-2 data-[state=open]:bg-paper-2 sm:flex",
            !task.dueOn && "text-ink-4 opacity-0 focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100",
          )}
        >
          {task.dueOn ? <DueLabel dueOn={task.dueOn} done={!open} /> : "Due date"}
        </button>
      </DuePicker>
      <AssigneePicker assigneeId={task.assigneeId} agentId={task.agentId} onChange={(choice) => void actions.update(task, choice)} align="end">
        <button
          type="button"
          aria-label="Change who has this task"
          className="flex size-9 shrink-0 items-center justify-center rounded-full transition-colors hover:bg-paper-2 data-[state=open]:bg-paper-2 [--avatar-ring:var(--surface)]"
        >
          <TaskAssigneeAvatar task={task} />
        </button>
      </AssigneePicker>
    </li>
  );
}
