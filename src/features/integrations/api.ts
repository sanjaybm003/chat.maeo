import { db, unwrap } from "@/features/workspace/api/client";
import { mapIntegration } from "@/lib/mappers";
import type { IntegrationProvider } from "@/types/domain";

import { TASK_EVENTS, type TaskEvent, type WebhookFormat } from "./lib/task-events";

export async function fetchIntegrations(workspaceId: string) {
  const rows = unwrap(await db().from("workspace_integrations").select("*").eq("workspace_id", workspaceId));
  return (rows ?? []).flatMap((row) => mapIntegration(row) ?? []);
}

export async function disconnectIntegration(workspaceId: string, provider: IntegrationProvider) {
  return unwrap(await db().rpc("disconnect_workspace_integration", { p_workspace_id: workspaceId, p_provider: provider }));
}

export async function setDefaultRepository(workspaceId: string, repo: string | null) {
  return unwrap(await db().rpc("set_integration_default_repo", { p_workspace_id: workspaceId, p_provider: "github", p_repo: repo }));
}

/** Starts the GitHub App installation for a workspace; the server checks who's asking. */
export const githubInstallPath = (slug: string) => `/api/integrations/github/install?workspace=${encodeURIComponent(slug)}`;

// Webhooks ────────────────────────────────────────────────────────────────────

export interface ChatWebhook {
  id: string;
  conversationId: string;
  name: string;
  createdBy: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface TaskWebhook {
  id: string;
  name: string;
  url: string;
  format: WebhookFormat;
  events: TaskEvent[];
  createdBy: string | null;
  createdAt: string;
  lastDeliveredAt: string | null;
  lastStatus: number | null;
}

interface ChatWebhookRow {
  id: string;
  conversation_id: string;
  name: string;
  created_by: string | null;
  created_at: string;
  last_used_at: string | null;
}

interface TaskWebhookRow {
  id: string;
  name: string;
  url: string;
  format: string;
  events: string[];
  created_by: string | null;
  created_at: string;
  last_delivered_at: string | null;
  last_status: number | null;
}

/** Everything but the hash of the link's secret, which clients can't read. */
const CHAT_WEBHOOK_COLUMNS = "id, conversation_id, name, created_by, created_at, last_used_at";

const mapChatWebhook = (row: ChatWebhookRow): ChatWebhook => ({
  id: row.id,
  conversationId: row.conversation_id,
  name: row.name,
  createdBy: row.created_by,
  createdAt: row.created_at,
  lastUsedAt: row.last_used_at,
});

const mapTaskWebhook = (row: TaskWebhookRow): TaskWebhook => ({
  id: row.id,
  name: row.name,
  url: row.url,
  format: row.format === "slack" || row.format === "discord" ? row.format : "json",
  events: row.events.filter((event): event is TaskEvent => (TASK_EVENTS as readonly string[]).includes(event)),
  createdBy: row.created_by,
  createdAt: row.created_at,
  lastDeliveredAt: row.last_delivered_at,
  lastStatus: row.last_status,
});

export async function fetchChatWebhooks(workspaceId: string) {
  const rows = unwrap(
    await db().from("chat_webhooks").select(CHAT_WEBHOOK_COLUMNS).eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
  );
  return (rows ?? []).map(mapChatWebhook);
}

/** The link's secret comes back only here, once. */
export async function createChatWebhook(conversationId: string, name: string) {
  const row = unwrap(await db().rpc("create_chat_webhook", { p_conversation_id: conversationId, p_name: name })) as unknown as ChatWebhookRow & {
    token: string;
  };
  return { webhook: mapChatWebhook(row), token: row.token };
}

export async function deleteChatWebhook(webhookId: string) {
  return unwrap(await db().rpc("delete_chat_webhook", { p_webhook_id: webhookId }));
}

export const chatWebhookUrl = (origin: string, webhookId: string, token: string) => `${origin}/api/hooks/${webhookId}/${token}`;

export async function fetchTaskWebhooks(workspaceId: string) {
  const rows = unwrap(await db().from("task_webhooks").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }));
  return (rows ?? []).map(mapTaskWebhook);
}

/** The signing secret comes back only here, once. */
export async function createTaskWebhook(workspaceId: string, input: { name: string; url: string; format: WebhookFormat; events: TaskEvent[] }) {
  const row = unwrap(
    await db().rpc("create_task_webhook", {
      p_workspace_id: workspaceId,
      p_name: input.name,
      p_url: input.url,
      p_format: input.format,
      p_events: input.events,
    }),
  ) as unknown as TaskWebhookRow & { secret: string };
  return { webhook: mapTaskWebhook(row), secret: row.secret };
}

export async function deleteTaskWebhook(webhookId: string) {
  return unwrap(await db().rpc("delete_task_webhook", { p_webhook_id: webhookId }));
}

/**
 * Lets the apps a workspace connected hear about a task change. Best effort:
 * it never holds up or undoes the change, and the server only sends what the
 * task really looks like now.
 */
export function reportTaskEvent(taskId: string, event: TaskEvent) {
  void fetch("/api/integrations/task-events", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ taskId, event }),
    keepalive: true,
  }).catch(() => undefined);
}
