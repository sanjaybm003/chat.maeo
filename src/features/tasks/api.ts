import { db, unwrap } from "@/features/workspace/api/client";
import { mapTask } from "@/lib/mappers";
import type { Task, TaskPriority, TaskStatus } from "@/types/domain";

/** Browser-side task calls. Every rule is enforced again by the database functions. */

export const TASK_WINDOW_DAYS = 30;

export interface TaskChanges {
  title?: string;
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  assigneeId?: string | null;
  agentId?: string | null;
  dueOn?: string | null;
}

export interface NewTask extends TaskChanges {
  title: string;
  conversationId?: string | null;
  messageId?: string | null;
}

function toFields(changes: TaskChanges & { conversationId?: string | null; messageId?: string | null }) {
  const fields: Record<string, string | null> = {};
  if (changes.title !== undefined) fields.title = changes.title;
  if (changes.description !== undefined) fields.description = changes.description;
  if (changes.status !== undefined) fields.status = changes.status;
  if (changes.priority !== undefined) fields.priority = changes.priority;
  if (changes.assigneeId !== undefined) fields.assignee_id = changes.assigneeId;
  if (changes.agentId !== undefined) fields.agent_id = changes.agentId;
  if (changes.dueOn !== undefined) fields.due_on = changes.dueOn;
  if (changes.conversationId !== undefined) fields.conversation_id = changes.conversationId;
  if (changes.messageId !== undefined) fields.message_id = changes.messageId;
  return fields;
}

function expectTask(value: unknown): Task {
  const task = mapTask(value);
  if (!task) throw new Error("The task couldn't be read. Refresh and try again.");
  return task;
}

export async function createTask(workspaceId: string, task: NewTask) {
  return expectTask(unwrap(await db().rpc("create_task", { p_workspace_id: workspaceId, p_fields: toFields(task) })));
}

export async function updateTask(taskId: string, changes: TaskChanges) {
  return expectTask(unwrap(await db().rpc("update_task", { p_task_id: taskId, p_fields: toFields(changes) })));
}

export async function deleteTask(taskId: string) {
  return unwrap(await db().rpc("delete_task", { p_task_id: taskId }));
}

export async function fetchTask(taskId: string) {
  const row = unwrap(await db().from("tasks").select("*").eq("id", taskId).maybeSingle());
  return row ? mapTask(row) : null;
}

export async function fetchTaskByNumber(workspaceId: string, number: number) {
  const row = unwrap(await db().from("tasks").select("*").eq("workspace_id", workspaceId).eq("number", number).maybeSingle());
  return row ? mapTask(row) : null;
}

/** Open tasks plus anything that changed in the last month: what the workspace keeps in memory. */
export async function fetchTasks(workspaceId: string) {
  const since = new Date(Date.now() - TASK_WINDOW_DAYS * 86_400_000).toISOString();
  const rows = unwrap(
    await db()
      .from("tasks")
      .select("*")
      .eq("workspace_id", workspaceId)
      .or(`status.in.(todo,in_progress,blocked),updated_at.gte.${since}`)
      .order("updated_at", { ascending: false })
      .limit(1000),
  );
  return (rows ?? []).flatMap((row) => mapTask(row) ?? []);
}
