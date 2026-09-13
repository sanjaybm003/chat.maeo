import { db, unwrap } from "@/features/workspace/api/client";
import { mapAgent, mapCreditAccount, mapUsageSummary } from "@/lib/mappers";

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
  created: boolean;
}

/** Wakes the agents a sent message calls on. Safe to repeat: runs are idempotent per message and agent. */
export function requestAgentReplies(messageId: string) {
  return postJson<{ runs: StartedRun[] }>("/api/ai/runs", { messageId });
}

export interface ArchitectResult {
  draft: AgentDraft;
  model: string;
  credits: number;
}

export function draftAgent(input: { workspaceId: string; prompt: string; current?: AgentDraft | null }, signal?: AbortSignal) {
  return postJson<ArchitectResult>("/api/ai/architect", input, signal);
}

export async function cancelAgentRun(runId: string) {
  return unwrap(await db().rpc("cancel_ai_run", { p_run_id: runId }));
}

export async function openAgentConversation(agentId: string) {
  return unwrap(await db().rpc("create_agent_conversation", { p_agent_id: agentId }));
}

export async function fetchAgent(agentId: string) {
  const row = unwrap(await db().from("ai_agents").select("*").eq("id", agentId).maybeSingle());
  return row ? mapAgent(row) : null;
}

export async function fetchCreditAccount(workspaceId: string) {
  const row = unwrap(
    await db()
      .from("ai_credit_accounts")
      .select("balance, reserved, lifetime_granted, lifetime_used")
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
  );
  return mapCreditAccount(row);
}

export async function fetchUsageSummary(workspaceId: string, days: number) {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  return mapUsageSummary(
    unwrap(await db().rpc("ai_usage_summary", { p_workspace_id: workspaceId, p_days: days, p_time_zone: timeZone })),
  );
}

export interface RecentRun {
  id: string;
  kind: "reply" | "architect";
  agentId: string | null;
  conversationId: string | null;
  triggeredBy: string | null;
  model: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  credits: number;
  inputTokens: number;
  outputTokens: number;
  toolCalls: number;
  createdAt: string;
  finishedAt: string | null;
}

export async function fetchRecentRuns(workspaceId: string, limit = 25): Promise<RecentRun[]> {
  const rows = unwrap(
    await db()
      .from("ai_runs")
      .select("id, kind, agent_id, conversation_id, triggered_by, model, status, credits_charged, input_tokens, output_tokens, tool_calls, created_at, finished_at")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(limit),
  );
  return (rows ?? []).map((row) => ({
    id: row.id,
    kind: row.kind,
    agentId: row.agent_id,
    conversationId: row.conversation_id,
    triggeredBy: row.triggered_by,
    model: row.model,
    status: row.status,
    credits: Number(row.credits_charged) || 0,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    toolCalls: row.tool_calls,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  }));
}
