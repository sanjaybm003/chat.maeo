import type { Task, TaskStatus } from "@/types/domain";

/** What a task webhook can listen for. */
export const TASK_EVENTS = ["task.created", "task.assigned", "task.completed", "task.updated"] as const;
export type TaskEvent = (typeof TASK_EVENTS)[number];

export const TASK_EVENT_LABELS: Record<TaskEvent, string> = {
  "task.created": "Created",
  "task.assigned": "Assigned",
  "task.completed": "Finished",
  "task.updated": "Changed",
};

export const WEBHOOK_FORMATS = ["json", "slack", "discord"] as const;
export type WebhookFormat = (typeof WEBHOOK_FORMATS)[number];

export const WEBHOOK_FORMAT_LABELS: Record<WebhookFormat, string> = {
  json: "JSON, signed",
  slack: "Slack or Google Chat",
  discord: "Discord",
};

type TaskState = Pick<Task, "status" | "assigneeId" | "agentId" | "version">;

/** Which event a saved change is, from the task before and after; null when nothing changed. */
export function taskEventFor(before: TaskState | null, after: TaskState): TaskEvent | null {
  if (!before) return "task.created";
  if (after.version === before.version) return null;
  if (after.status === "done" && before.status !== "done") return "task.completed";
  const assignedPerson = after.assigneeId !== null && after.assigneeId !== before.assigneeId;
  const assignedAgent = after.agentId !== null && after.agentId !== before.agentId;
  return assignedPerson || assignedAgent ? "task.assigned" : "task.updated";
}

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
  cancelled: "Cancelled",
};

export interface TaskEventDetails {
  event: TaskEvent;
  number: number;
  title: string;
  status: TaskStatus;
  /** Who made the change: "Priya", or "Scout for Priya" when an agent did. */
  actor: string;
  assignee: string | null;
  dueOn: string | null;
  url: string;
}

const slackEscape = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const discordEscape = (text: string) => text.replace(/([\\[\]*_~`|])/g, "\\$1");

/** One line about the change, written for where it's going. */
export function taskEventText(details: TaskEventDetails, format: WebhookFormat) {
  const title = details.title.replace(/\s+/g, " ").trim();
  const key = `T-${details.number}`;
  const head =
    format === "slack"
      ? `*${key}* <${details.url}|${slackEscape(title)}>`
      : format === "discord"
        ? `**${key}** [${discordEscape(title)}](<${details.url}>)`
        : `${key} ${title}`;
  const escape = format === "slack" ? slackEscape : format === "discord" ? discordEscape : (text: string) => text;
  const actor = escape(details.actor);
  const assignee = details.assignee ? escape(details.assignee) : null;
  const change: Record<TaskEvent, string> = {
    "task.created": `was created by ${actor}${assignee ? ` for ${assignee}` : ""}`,
    "task.assigned": `was assigned to ${assignee ?? "nobody"} by ${actor}`,
    "task.completed": `was finished by ${actor}`,
    "task.updated": `was updated by ${actor} · ${STATUS_LABELS[details.status]}`,
  };
  const due = details.dueOn && details.event !== "task.completed" ? ` · due ${details.dueOn}` : "";
  return `${head} ${change[details.event]}${due}${format === "json" ? ` · ${details.url}` : ""}`;
}
