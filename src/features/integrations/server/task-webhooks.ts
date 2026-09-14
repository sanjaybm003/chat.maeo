import "server-only";

import { createHmac, randomUUID } from "node:crypto";

import type { AdminClient } from "@/features/ai/server/directory";
import { checkPublicUrl, WebToolError } from "@/features/ai/server/web";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { absoluteUrl, routes } from "@/lib/routes";
import type { Tables } from "@/types/database";
import type { TaskStatus } from "@/types/domain";

import { taskEventText, type TaskEvent, type TaskEventDetails, type WebhookFormat } from "../lib/task-events";

/**
 * Tells the apps a workspace connected about task changes. Every request is
 * signed with the webhook's own secret, goes only to public addresses, never
 * follows redirects, and is tried twice at most.
 */

const log = logger.child({ module: "task-webhooks" });

const DELIVERY_TIMEOUT_MS = 8_000;
const RETRY_DELAY_MS = 1_500;

interface Target {
  id: string;
  name: string;
  url: string;
  format: string;
  secret: string;
}

/** `sha256=` and the HMAC-SHA256 of "timestamp.body" under the webhook's secret. */
export function signWebhook(secret: string, timestamp: string, body: string) {
  return `sha256=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

const asFormat = (value: string): WebhookFormat => (value === "slack" || value === "discord" ? value : "json");

function bodyFor(format: WebhookFormat, details: TaskEventDetails, payload: Record<string, unknown>) {
  if (format === "slack") return JSON.stringify({ text: taskEventText(details, "slack") });
  if (format === "discord") return JSON.stringify({ content: taskEventText(details, "discord"), allowed_mentions: { parse: [] } });
  return JSON.stringify({ ...payload, text: taskEventText(details, "json") });
}

/** The HTTP status the app answered with, or 0 when it couldn't be reached. */
async function send(target: Target, event: TaskEvent, body: string): Promise<number> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const timestamp = String(Math.floor(Date.now() / 1000));
    try {
      const url = await checkPublicUrl(target.url);
      const response = await fetch(url, {
        method: "POST",
        redirect: "manual",
        cache: "no-store",
        signal: AbortSignal.timeout(DELIVERY_TIMEOUT_MS),
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "maeosan-webhooks/1.0",
          "X-Maeosan-Event": event,
          "X-Maeosan-Delivery": randomUUID(),
          "X-Maeosan-Timestamp": timestamp,
          "X-Maeosan-Signature": signWebhook(target.secret, timestamp, body),
        },
        body,
      });
      await response.body?.cancel().catch(() => undefined);
      if ((response.status < 500 && response.status !== 429) || attempt === 1) return response.status;
    } catch (error) {
      // A private or malformed address won't get better on a second try.
      if (error instanceof WebToolError || attempt === 1) {
        log.warn("task webhook couldn't be delivered", { webhookId: target.id, detail: error instanceof Error ? error.message : String(error) });
        return 0;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
  }
  return 0;
}

async function deliver(admin: AdminClient, targets: Target[], event: TaskEvent, details: TaskEventDetails, payload: Record<string, unknown>) {
  await Promise.all(
    targets.map(async (target) => {
      const status = await send(target, event, bodyFor(asFormat(target.format), details, payload));
      const { error } = await admin.rpc("record_task_webhook_delivery", { p_webhook_id: target.id, p_status: status });
      if (error) log.warn("couldn't record a task webhook delivery", { webhookId: target.id, error });
    }),
  );
}

async function assigneeName(admin: AdminClient, task: Pick<Tables<"tasks">, "assignee_id" | "agent_id">) {
  if (task.agent_id) {
    const { data } = await admin.from("ai_agents").select("name").eq("id", task.agent_id).maybeSingle();
    return data ? `${data.name} (agent)` : "an agent";
  }
  if (task.assignee_id) {
    const { data } = await admin.from("profiles").select("display_name, full_name, email").eq("id", task.assignee_id).maybeSingle();
    return data ? data.display_name || data.full_name || data.email.split("@")[0] : "a former member";
  }
  return null;
}

export interface TaskEventInput {
  event: TaskEvent;
  taskId: string;
  /** "Priya", or "Scout for Priya" when an agent made the change. */
  actorName: string;
}

/** Sends one task event to every webhook in the task's workspace listening for it. Returns how many were tried. */
export async function deliverTaskEvent(admin: AdminClient, input: TaskEventInput): Promise<number> {
  const { data: task, error } = await admin.from("tasks").select("*").eq("id", input.taskId).maybeSingle();
  if (error || !task) return 0;

  const { data: targets, error: targetsError } = await admin.rpc("task_webhook_targets", {
    p_workspace_id: task.workspace_id,
    p_event: input.event,
  });
  if (targetsError) {
    log.warn("couldn't look up task webhooks", { error: targetsError });
    return 0;
  }
  if (!targets || targets.length === 0) return 0;

  const [{ data: workspace }, assignee] = await Promise.all([
    admin.from("workspaces").select("id, name, slug").eq("id", task.workspace_id).single(),
    assigneeName(admin, task),
  ]);
  const url = absoluteUrl(env.siteUrl, workspace ? routes.task(workspace.slug, task.number) : "/");
  const details: TaskEventDetails = {
    event: input.event,
    number: task.number,
    title: task.title,
    status: task.status as TaskStatus,
    actor: input.actorName,
    assignee,
    dueOn: task.due_on,
    url,
  };
  const payload = {
    event: input.event,
    sent_at: new Date().toISOString(),
    workspace: workspace ? { id: workspace.id, name: workspace.name } : { id: task.workspace_id, name: null },
    actor: input.actorName,
    task: {
      id: task.id,
      key: `T-${task.number}`,
      number: task.number,
      title: task.title,
      description: task.description,
      status: task.status,
      priority: task.priority,
      assignee: assignee ? { kind: task.agent_id ? "agent" : "person", name: assignee } : null,
      due_on: task.due_on,
      url,
      created_at: task.created_at,
      updated_at: task.updated_at,
      completed_at: task.completed_at,
    },
  };

  await deliver(admin, targets, input.event, details, payload);
  return targets.length;
}

/** "Send test" in settings: a sample event to one webhook, whatever it listens for. Returns the app's HTTP status. */
export async function sendTestTaskEvent(admin: AdminClient, input: { workspaceId: string; webhookId: string; actorName: string }) {
  const { data: targets, error } = await admin.rpc("task_webhook_targets", {
    p_workspace_id: input.workspaceId,
    p_event: "task.created",
    p_webhook_id: input.webhookId,
  });
  if (error) throw error;
  const target = targets?.[0];
  if (!target) return null;

  const { data: workspace } = await admin.from("workspaces").select("id, name, slug").eq("id", input.workspaceId).single();
  const url = absoluteUrl(env.siteUrl, workspace ? routes.tasks(workspace.slug) : "/");
  const details: TaskEventDetails = {
    event: "task.created",
    number: 0,
    title: "Test from maeosan: this webhook works",
    status: "todo",
    actor: input.actorName,
    assignee: null,
    dueOn: null,
    url,
  };
  const body = bodyFor(asFormat(target.format), details, {
    event: "task.created",
    test: true,
    sent_at: new Date().toISOString(),
    workspace: workspace ? { id: workspace.id, name: workspace.name } : null,
    actor: input.actorName,
    task: { key: "T-0", number: 0, title: details.title, status: "todo", url },
  });
  const status = await send(target, "task.created", body);
  await admin.rpc("record_task_webhook_delivery", { p_webhook_id: target.id, p_status: status });
  return status;
}
