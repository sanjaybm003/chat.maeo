import type { PersonColor, Task, TaskPriority, TaskStatus } from "@/types/domain";

import { daysBetween, shortDate, WEEKDAY_NAMES, weekdayOf } from "./dates";

export const TASK_STATUS_META: Record<TaskStatus, { label: string; color: PersonColor | null }> = {
  todo: { label: "To do", color: null },
  in_progress: { label: "In progress", color: "saffron" },
  blocked: { label: "Blocked", color: "tomato" },
  done: { label: "Done", color: "grass" },
  cancelled: { label: "Cancelled", color: null },
};

/** How statuses are grouped on the page: work underway first, finished work last. */
export const STATUS_ORDER: readonly TaskStatus[] = ["in_progress", "todo", "blocked", "done", "cancelled"];

export const TASK_PRIORITY_META: Record<TaskPriority, { label: string; rank: number }> = {
  urgent: { label: "Urgent", rank: 4 },
  high: { label: "High", rank: 3 },
  medium: { label: "Medium", rank: 2 },
  low: { label: "Low", rank: 1 },
  none: { label: "No priority", rank: 0 },
};

export const PRIORITY_ORDER: readonly TaskPriority[] = ["urgent", "high", "medium", "low", "none"];

export const taskKey = (number: number) => `T-${number}`;

export const isOpenTask = (task: Pick<Task, "status">) => task.status !== "done" && task.status !== "cancelled";

export type DueTone = "overdue" | "today" | "soon" | "later";

export function describeDue(dueOn: string, todayIso: string): { label: string; tone: DueTone } {
  const diff = daysBetween(todayIso, dueOn);
  if (diff < 0) return { label: diff === -1 ? "Yesterday" : `${-diff} days late`, tone: "overdue" };
  if (diff === 0) return { label: "Today", tone: "today" };
  if (diff === 1) return { label: "Tomorrow", tone: "soon" };
  if (diff < 7) return { label: WEEKDAY_NAMES[weekdayOf(dueOn)], tone: "soon" };
  return { label: shortDate(dueOn, todayIso), tone: "later" };
}

const time = (iso: string | null) => (iso ? Date.parse(iso) || 0 : 0);

/**
 * Open work first: most urgent, then soonest due, then newest. Finished work
 * after it, most recently finished first.
 */
export function compareTasks(a: Task, b: Task) {
  const openFirst = Number(isOpenTask(b)) - Number(isOpenTask(a));
  if (openFirst !== 0) return openFirst;
  if (!isOpenTask(a)) return time(b.completedAt ?? b.updatedAt) - time(a.completedAt ?? a.updatedAt) || b.number - a.number;

  const priority = TASK_PRIORITY_META[b.priority].rank - TASK_PRIORITY_META[a.priority].rank;
  if (priority !== 0) return priority;
  if (a.dueOn !== b.dueOn) {
    if (!a.dueOn) return 1;
    if (!b.dueOn) return -1;
    return a.dueOn < b.dueOn ? -1 : 1;
  }
  return b.number - a.number;
}

export type TaskView = "mine" | "created" | "agents" | "all";

export const TASK_VIEWS: ReadonlyArray<{ value: TaskView; label: string }> = [
  { value: "mine", label: "Assigned to me" },
  { value: "created", label: "Created by me" },
  { value: "agents", label: "Agents" },
  { value: "all", label: "Everything" },
];

export function inView(task: Task, view: TaskView, meId: string) {
  switch (view) {
    case "mine":
      return task.assigneeId === meId;
    case "created":
      return task.createdBy === meId;
    case "agents":
      return task.agentId !== null;
    case "all":
      return true;
  }
}

/** "t-12", "12", words from the title or description, or who it's assigned to. */
export function matchesTaskQuery(task: Task, query: string, assigneeName: string | null) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const number = needle.replace(/^t-?/, "");
  if (/^\d+$/.test(number) && String(task.number) === number) return true;
  const haystack = `${task.title}\n${task.description}\n${assigneeName ?? ""}`.toLowerCase();
  return needle.split(/\s+/).every((word) => haystack.includes(word));
}

export interface WorkSummary {
  /** Open tasks assigned to this person, most pressing first. */
  mine: Task[];
  late: number;
  dueToday: number;
  /** Open tasks that came from this chat, whoever has them. */
  here: Task[];
  /** Open tasks this person gave to agents. */
  withAgents: Task[];
  /** Their work finished since the given moment. */
  finished: Task[];
}

/** What's on one person's plate, for "My work" in a chat. */
export function summarizeWork(
  tasks: readonly Task[],
  meId: string,
  { conversationId, today, since }: { conversationId: string | null; today: string | null; since: string | null },
): WorkSummary {
  const open = tasks.filter(isOpenTask);
  const mine = open.filter((task) => task.assigneeId === meId).sort(compareTasks);
  const sinceTime = since ? Date.parse(since) : Number.NaN;
  const ours = (task: Task) => task.assigneeId === meId || (task.agentId !== null && task.createdBy === meId);
  return {
    mine,
    late: today ? mine.filter((task) => task.dueOn !== null && task.dueOn < today).length : 0,
    dueToday: today ? mine.filter((task) => task.dueOn === today).length : 0,
    here: conversationId ? open.filter((task) => task.conversationId === conversationId).sort(compareTasks) : [],
    withAgents: open.filter((task) => task.agentId !== null && task.createdBy === meId).sort(compareTasks),
    finished: Number.isNaN(sinceTime)
      ? []
      : tasks.filter((task) => task.status === "done" && ours(task) && Date.parse(task.completedAt ?? "") >= sinceTime).sort(compareTasks),
  };
}

/** A short status update in plain words, ready to post: done, underway, stuck, next. */
export function workUpdate(work: WorkSummary, today: string | null) {
  const due = (task: Task) => {
    if (!task.dueOn || !today) return "";
    const { label, tone } = describeDue(task.dueOn, today);
    if (tone === "overdue") return " (late)";
    return ` (due ${label === "Today" || label === "Tomorrow" ? label.toLowerCase() : label})`;
  };
  const line = (label: string, tasks: readonly Task[], max: number, withDue: boolean) => {
    if (tasks.length === 0) return null;
    const names = tasks.slice(0, max).map((task) => `${taskKey(task.number)} ${task.title}${withDue ? due(task) : ""}`);
    const more = tasks.length > max ? `, and ${tasks.length - max} more` : "";
    return `${label}: ${names.join(", ")}${more}`;
  };
  const lines = [
    line("Done", work.finished, 4, false),
    line("Working on", work.mine.filter((task) => task.status === "in_progress"), 3, true),
    line("Blocked", work.mine.filter((task) => task.status === "blocked"), 3, false),
    line("Next", work.mine.filter((task) => task.status === "todo"), 3, true),
  ].filter((value): value is string => value !== null);
  return ["My update", ...(lines.length > 0 ? lines : ["Nothing open on my side right now."])].join("\n");
}

export function groupByStatus(tasks: readonly Task[]) {
  return STATUS_ORDER.map((status) => ({
    status,
    tasks: tasks.filter((task) => task.status === status).sort(compareTasks),
  })).filter((group) => group.tasks.length > 0);
}
