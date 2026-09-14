import { db, unwrap } from "@/features/workspace/api/client";
import { mapAgent, mapCreditAccount, mapUsageSummary } from "@/lib/mappers";
import type { Specialty } from "@/types/domain";

import type { AgentDraft } from "./agent-spec";

/** Browser-side calls for agents. Everything is authorised again on the server. */

export class AiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null,
  ) {
    super(message);
    this.name = "AiRequestError";
  }
}

async function postJson<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new AiRequestError("You seem to be offline. Check your connection.", 0, "network");
  }
  const data = (await response.json().catch(() => null)) as { error?: string; code?: string } | null;
  if (!response.ok) {
    throw new AiRequestError(data?.error ?? "Something went wrong. Please try again.", response.status, data?.code ?? null);
  }
  return data as T;
}

export interface StartedRun {
  runId: string;
  messageId: string;
  agentId: string;
  model: string;
  created: boolean;
}

/**
 * Wakes the agents a sent message calls on. `model` is a model picked for this
 * one message, or null for each agent's own setting. Safe to repeat: runs are
 * idempotent per message and agent.
 */
export function requestAgentReplies(messageId: string, model?: string | null) {
  // Agents use the sender's clock for "today", message times and due dates.
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return postJson<{ runs: StartedRun[] }>("/api/ai/runs", { messageId, model: model ?? null, timeZone });
}

/** Serverless instances go cold after a few idle minutes; this keeps one ready while someone is typing. */
const WARM_EVERY_MS = 4 * 60_000;
let warmedAt = 0;

/** While someone writes to an agent: readies the reply server, so the answer starts sooner once they send. */
export function warmAgentReplies() {
  const now = Date.now();
  if (now - warmedAt < WARM_EVERY_MS) return;
  warmedAt = now;
  void fetch("/api/ai/runs", { method: "GET", cache: "no-store", keepalive: true }).catch(() => {
    warmedAt = 0;
  });
}

export interface ArchitectResult {
  draft: AgentDraft;
  model: string;
  credits: number;
}

export function draftAgent(
  input: { workspaceId: string; prompt: string; specialty?: Specialty | null; current?: AgentDraft | null },
  signal?: AbortSignal,
) {
  return postJson<ArchitectResult>("/api/ai/architect", input, signal);
}

export async function cancelAgentRun(runId: string) {
  return unwrap(await db().rpc("cancel_ai_run", { p_run_id: runId }));
}

export async function openAgentConversation(agentId: string) {
  return unwrap(await db().rpc("create_agent_conversation", { p_agent_id: agentId }));
}

export async function addAgentToConversation(conversationId: string, agentId: string) {
  return unwrap(await db().rpc("add_agent_to_conversation", { p_conversation_id: conversationId, p_agent_id: agentId }));
}

export async function removeAgentFromConversation(conversationId: string, agentId: string) {
  return unwrap(await db().rpc("remove_agent_from_conversation", { p_conversation_id: conversationId, p_agent_id: agentId }));
}

export async function fetchAgent(agentId: string) {
  const row = unwrap(await db().from("ai_agents").select("*").eq("id", agentId).maybeSingle());
  return row ? mapAgent(row) : null;
}

export async function fetchCreditAccount(userId: string) {
  const row = unwrap(
    await db().from("ai_wallets").select("balance, reserved, lifetime_granted, lifetime_used").eq("user_id", userId).maybeSingle(),
  );
  return mapCreditAccount(row);
}

/** The signed-in person's usage across every workspace. */
export async function fetchUsageSummary(days: number) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return mapUsageSummary(unwrap(await db().rpc("ai_my_usage", { p_days: days, p_time_zone: timeZone })));
}

export interface RecentRun {
  id: string;
  kind: "reply" | "architect";
  workspaceId: string;
  agentId: string | null;
  model: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  credits: number;
  inputTokens: number;
  outputTokens: number;
  toolCalls: number;
  createdAt: string;
  finishedAt: string | null;
  /** Why a run failed, including the provider's reason. Runs are private to the person who asked. */
  error: string | null;
}

/** Runs are private to the person who asked, so this is always "my runs". */
export async function fetchRecentRuns(limit = 25): Promise<RecentRun[]> {
  const rows = unwrap(
    await db()
      .from("ai_runs")
      .select("id, kind, workspace_id, agent_id, model, status, credits_charged, input_tokens, output_tokens, tool_calls, created_at, finished_at, error")
      .order("created_at", { ascending: false })
      .limit(limit),
  );
  return (rows ?? []).map((row) => ({
    id: row.id,
    kind: row.kind,
    workspaceId: row.workspace_id,
    agentId: row.agent_id,
    model: row.model,
    status: row.status,
    credits: Number(row.credits_charged) || 0,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    toolCalls: row.tool_calls,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
    error: row.error,
  }));
}
