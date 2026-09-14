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

export function groupByStatus(tasks: readonly Task[]) {
  return STATUS_ORDER.map((status) => ({
    status,
    tasks: tasks.filter((task) => task.status === status).sort(compareTasks),
  })).filter((group) => group.tasks.length > 0);
}
