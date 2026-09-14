import "server-only";

import type { TaskEvent } from "@/features/integrations/lib/task-events";
import { deliverTaskEvent } from "@/features/integrations/server/task-webhooks";
import { parseQuickTask } from "@/features/tasks/lib/quick-task";
import { TASK_PRIORITIES, TASK_STATUSES, type AgentRunStep } from "@/types/domain";

import { localToday } from "../lib/time";
import type { AdminClient, NameDirectory } from "./directory";
import type { ToolCall, ToolSpec } from "./providers/types";
import { ToolInputError } from "./tool-errors";

/**
 * Agents work with the team's tasks on behalf of the person who asked: every
 * change runs through the same database rules as a person's, credited to both,
 * and reaches the apps the workspace connected just like a person's change.
 */

export interface TaskToolContext {
  admin: AdminClient;
  directory: NameDirectory;
  workspaceId: string;
  conversationId: string;
  userId: string;
  agentId: string;
  /** The asker's time zone, so "friday" is their Friday. */
  timeZone: string;
  agentName?: string;
  /** Where deliveries to connected apps are collected, so the run can wait for them; without it none are sent. */
  background?: Promise<unknown>[];
}

const STATUS_WORDS = "todo, in_progress, blocked, done or cancelled";

export const TASK_TOOL_SPECS: ToolSpec[] = [
  {
    name: "list_tasks",
    description:
      "List the team's tasks with their number (T-12), title, status, priority, assignee and due date. Check it before creating a task, and to answer questions about who is doing what.",
    parameters: {
      type: "object",
      properties: {
        status: {
          type: "string",
          enum: ["open", ...TASK_STATUSES, "all"],
          description: "Which tasks. open (the default) means to do, in progress and blocked.",
        },
        assignee: {
          type: "string",
          description: "Only tasks for this person or agent: a name, an agent's @handle, \"me\" for the person you're replying to, or \"nobody\".",
        },
        query: { type: "string", description: "Words to find in titles and descriptions." },
      },
    },
  },
  {
    name: "create_task",
    description:
      "Create a task for the team and share it in this chat. Only create tasks someone asked for or agreed to, and check list_tasks first so you don't make a duplicate.",
    parameters: {
      type: "object",
      properties: {
        title: { type: "string", description: "A short, specific action under 120 characters, like \"Send the Q3 invoice to Acme\"." },
        description: { type: "string", description: "What makes it doable: context, links, and what done looks like." },
        assignee: {
          type: "string",
          description:
            "Who does it: a teammate's name, an agent's @handle, or \"me\" for the person you're replying to. Leave it out when nobody was named; never guess.",
        },
        due_on: { type: "string", description: "The due date as YYYY-MM-DD, only when one was given." },
        priority: { type: "string", enum: [...TASK_PRIORITIES] },
      },
      required: ["title"],
    },
  },
  {
    name: "update_task",
    description: "Change a task by its number: mark it done or in progress, reassign it, or change its title, description, due date or priority.",
    parameters: {
      type: "object",
      properties: {
        number: { type: "integer", description: "The task number, like 12 for T-12." },
        status: { type: "string", enum: [...TASK_STATUSES] },
        title: { type: "string" },
        description: { type: "string" },
        assignee: { type: "string", description: "A name, an agent's @handle, \"me\", or \"nobody\" to unassign." },
        due_on: { type: "string", description: "YYYY-MM-DD, or \"none\" to clear it." },
        priority: { type: "string", enum: [...TASK_PRIORITIES] },
      },
      required: ["number"],
    },
  },
];

export const TASK_TOOL_NAMES: ReadonlySet<string> = new Set(TASK_TOOL_SPECS.map((spec) => spec.name));

const clean = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");
const squash = (value: string) => value.toLowerCase().replace(/[\s._-]+/g, "");

export function describeTaskToolCall(call: ToolCall): AgentRunStep | null {
  switch (call.name) {
    case "list_tasks":
      return { kind: "tool", label: "Checking the team’s tasks" };
    case "create_task": {
      const title = clean(call.input.title, 70);
      return { kind: "tool", label: title ? `Creating a task: ${title}` : "Creating a task" };
    }
    case "update_task":
      return { kind: "tool", label: `Updating T-${clean(String(call.input.number ?? ""), 8).replace(/^t-?/i, "") || "?"}` };
    default:
      return null;
  }
}

interface Assignment {
  assigneeId: string | null;
  agentId: string | null;
}

/** "me", "nobody", an agent's @handle or name, or a teammate: exact first, then one unambiguous prefix. */
export function resolveAssignee(raw: string, { directory, userId }: Pick<TaskToolContext, "directory" | "userId">): Assignment {
  const value = raw.trim().replace(/^@/, "");
  if (/^(me|myself|i|the asker|requester)$/i.test(value)) return { assigneeId: userId, agentId: null };
  if (/^(nobody|none|no one|noone|unassigned)$/i.test(value)) return { assigneeId: null, agentId: null };

  const key = squash(value);
  for (const [id, agent] of directory.agents) {
    if (agent.handle === value.toLowerCase() || squash(agent.name) === key) return { assigneeId: null, agentId: id };
  }

  const people = [...directory.people.values()];
  const exact = people.filter((person) => squash(person.name) === key || squash(person.name.split(/\s+/)[0] ?? "") === key);
  if (exact.length === 1) return { assigneeId: exact[0].id, agentId: null };
  const partial = exact.length === 0 && key.length >= 2 ? people.filter((person) => squash(person.name).startsWith(key)) : [];
  if (partial.length === 1) return { assigneeId: partial[0].id, agentId: null };

  const candidates = (exact.length > 1 ? exact : partial).slice(0, 5).map((person) => person.name);
  throw new ToolInputError(
    candidates.length > 1
      ? `"${raw}" could be ${candidates.join(", ")}. Use their full name.`
      : `Nobody called "${raw}" is in this workspace. Check the name, or leave the task unassigned.`,
  );
}

function dueDate(raw: string, timeZone: string): string {
  const value = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const understood = parseQuickTask(`due ${value}`, { members: [], agents: [] }, localToday(timeZone)).dueOn;
  if (!understood) throw new ToolInputError(`"${raw}" isn't a date. Give due dates as YYYY-MM-DD.`);
  return understood;
}

function describeWho(directory: NameDirectory, task: { assignee_id: string | null; agent_id: string | null }) {
  if (task.agent_id) return `${directory.agents.get(task.agent_id)?.name ?? "an agent"} (agent)`;
  return task.assignee_id ? directory.personName(task.assignee_id) : "unassigned";
}

function friendly(error: { code?: string; message: string }): never {
  if (error.code === "22023" || error.code === "P0429" || error.code === "42501") throw new ToolInputError(error.message);
  throw error;
}

interface SavedTask {
  id: string;
  number: number;
  title: string;
  status: string;
  due_on: string | null;
  assignee_id: string | null;
  agent_id: string | null;
}

/** What a save was, for the apps listening to the workspace's tasks. */
export function taskToolEvent(isNew: boolean, fields: Record<string, string | null>, previousStatus: string | null, saved: SavedTask): TaskEvent {
  if (isNew) return "task.created";
  if (saved.status === "done" && previousStatus !== "done") return "task.completed";
  const reassigned = ("assignee_id" in fields || "agent_id" in fields) && Boolean(saved.assignee_id || saved.agent_id);
  return reassigned ? "task.assigned" : "task.updated";
}

async function saveTask(context: TaskToolContext, taskId: string | null, fields: Record<string, string | null>, previousStatus: string | null = null) {
  const { data, error } = await context.admin.rpc("ai_save_task", {
    p_user_id: context.userId,
    p_agent_id: context.agentId,
    p_task_id: taskId,
    p_workspace_id: taskId ? null : context.workspaceId,
    p_fields: fields,
  });
  if (error) friendly(error);
  const task = data as unknown as SavedTask;
  // Connected apps hear about it without holding up the reply.
  context.background?.push(
    deliverTaskEvent(context.admin, {
      event: taskToolEvent(!taskId, fields, previousStatus, task),
      taskId: task.id,
      actorName: `${context.agentName ?? "An agent"} for ${context.directory.personName(context.userId)}`,
    }).catch(() => 0),
  );
  return task;
}

async function listTasks(input: Record<string, unknown>, context: TaskToolContext) {
  const status = clean(input.status, 20) || "open";
  let query = context.admin
    .from("tasks")
    .select("number, title, status, priority, assignee_id, agent_id, due_on")
    .eq("workspace_id", context.workspaceId);

  if (status === "open") query = query.in("status", ["todo", "in_progress", "blocked"]);
  else if ((TASK_STATUSES as readonly string[]).includes(status)) query = query.eq("status", status);

  const who = clean(input.assignee, 80);
  if (who) {
    const assignment = resolveAssignee(who, context);
    if (assignment.agentId) query = query.eq("agent_id", assignment.agentId);
    else if (assignment.assigneeId) query = query.eq("assignee_id", assignment.assigneeId);
    else query = query.is("assignee_id", null).is("agent_id", null);
  }

  // Characters that carry meaning in a PostgREST filter are dropped from the search words.
  const words = clean(input.query, 80).replace(/[,()%*_\\"'.:]/g, " ").trim();
  if (words) query = query.or(`title.ilike.%${words}%,description.ilike.%${words}%`);

  const { data, error } = await query.order("updated_at", { ascending: false }).limit(40);
  if (error) throw error;
  if (!data || data.length === 0) return "No tasks match.";

  const lines = data.map(
    (task) =>
      `- T-${task.number} [${task.status}] ${task.title}${task.priority !== "none" ? ` · ${task.priority} priority` : ""} · ${describeWho(context.directory, task)}${task.due_on ? ` · due ${task.due_on}` : ""}`,
  );
  return `${lines.join("\n")}${data.length === 40 ? "\n(There are more; narrow the search.)" : ""}`;
}

async function createTask(input: Record<string, unknown>, context: TaskToolContext) {
  const title = clean(input.title, 200);
  if (!title) throw new ToolInputError("Give the task a title.");
  const fields: Record<string, string | null> = { title, conversation_id: context.conversationId };
  if (typeof input.description === "string" && input.description.trim()) fields.description = input.description.trim().slice(0, 8000);
  if (clean(input.assignee, 80)) {
    const assignment = resolveAssignee(clean(input.assignee, 80), context);
    fields.assignee_id = assignment.assigneeId;
    fields.agent_id = assignment.agentId;
  }
  if (clean(input.due_on, 40)) fields.due_on = dueDate(clean(input.due_on, 40), context.timeZone);
  if ((TASK_PRIORITIES as readonly string[]).includes(clean(input.priority, 10))) fields.priority = clean(input.priority, 10);

  const task = await saveTask(context, null, fields);
  const who = task.assignee_id || task.agent_id ? ` for ${describeWho(context.directory, task)}` : ", unassigned";
  return `Created T-${task.number}: ${task.title}${who}${task.due_on ? `, due ${task.due_on}` : ""}. It's shared in this chat; refer to it as T-${task.number}.`;
}

async function updateTask(input: Record<string, unknown>, context: TaskToolContext) {
  const number = Number(String(input.number ?? "").replace(/^t-?/i, ""));
  if (!Number.isInteger(number) || number < 1) throw new ToolInputError("Give the task's number, like 12 for T-12.");

  const { data: row, error } = await context.admin
    .from("tasks")
    .select("id, status")
    .eq("workspace_id", context.workspaceId)
    .eq("number", number)
    .maybeSingle();
  if (error) throw error;
  if (!row) throw new ToolInputError(`There is no T-${number} in this workspace. Use list_tasks to find the right number.`);

  const fields: Record<string, string | null> = {};
  const status = clean(input.status, 20);
  if (status) {
    if (!(TASK_STATUSES as readonly string[]).includes(status)) throw new ToolInputError(`Status must be ${STATUS_WORDS}.`);
    fields.status = status;
  }
  if (clean(input.title, 200)) fields.title = clean(input.title, 200);
  if (typeof input.description === "string") fields.description = input.description.trim().slice(0, 8000);
  const priority = clean(input.priority, 10);
  if (priority) {
    if (!(TASK_PRIORITIES as readonly string[]).includes(priority)) throw new ToolInputError("Priority must be none, low, medium, high or urgent.");
    fields.priority = priority;
  }
  if (clean(input.assignee, 80)) {
    const assignment = resolveAssignee(clean(input.assignee, 80), context);
    fields.assignee_id = assignment.assigneeId;
    fields.agent_id = assignment.agentId;
  }
  const due = clean(input.due_on, 40);
  if (due) fields.due_on = /^(none|no|null|clear|remove)$/i.test(due) ? null : dueDate(due, context.timeZone);

  if (Object.keys(fields).length === 0) {
    throw new ToolInputError("Say what to change: status, title, description, assignee, due_on or priority.");
  }
  const task = await saveTask(context, row.id, fields, row.status);
  return `Updated T-${task.number}: ${task.title} · ${task.status} · ${describeWho(context.directory, task)}${task.due_on ? ` · due ${task.due_on}` : ""}.`;
}

export async function executeTaskTool(call: ToolCall, context: TaskToolContext): Promise<string> {
  switch (call.name) {
    case "list_tasks":
      return listTasks(call.input, context);
    case "create_task":
      return createTask(call.input, context);
    case "update_task":
      return updateTask(call.input, context);
    default:
      throw new ToolInputError(`There is no tool named ${call.name}.`);
  }
}
