import { after, NextResponse } from "next/server";
import { z } from "zod";

import { extractMentionHandles } from "@/features/ai/mentions";
import { routeModel } from "@/features/ai/router";
import { configuredModels } from "@/features/ai/server/env";
import { runAgentReply } from "@/features/ai/server/run-reply";
import { toResponseStyle, toSpecialty } from "@/features/ai/specialties";
import { MAX_AGENTS_PER_MESSAGE } from "@/features/ai/wake";
import { serverEnv } from "@/lib/env.server";
import { logger } from "@/lib/logger";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database";

/** Replies stream after the response; this bounds how long they may run. */
export const maxDuration = 300;

const bodySchema = z.object({
  messageId: z.guid(),
  /** A model picked for this message, or "auto". */
  model: z.string().max(80).nullish(),
});

const log = logger.child({ module: "api-ai-runs" });

const reply = (status: number, body: Record<string, unknown>) => NextResponse.json(body, { status });
const unavailable = () => reply(503, { error: "AI agents aren’t available right now. Try again soon.", code: "unavailable" });

function startError(code: string | undefined) {
  switch (code) {
    case "P0402":
      return reply(402, { error: "You’re out of AI credits.", code: "out_of_credits" });
    case "P0429":
      return reply(429, { error: "You’re calling agents quickly. Give it a moment.", code: "rate_limited" });
    default:
      return reply(500, { error: "The agent couldn’t start. Try again.", code: "start_failed" });
  }
}

/**
 * Starts agent replies for a message the signed-in person just sent. Which
 * agents answer, which model each one uses and whether the person's credits
 * allow it are all decided here and in the database, never by the browser.
 */
export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return reply(400, { error: "That request wasn't valid.", code: "invalid" });

  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  const user = auth.user;
  if (!user) return reply(401, { error: "Your session ended. Sign in again.", code: "unauthorized" });

  // Read as the person, so row level security proves they can see the message.
  const { data: message } = await supabase
    .from("messages")
    .select("id, conversation_id, sender_id, kind, body, reply_to_id, deleted_at")
    .eq("id", parsed.data.messageId)
    .maybeSingle();
  if (!message || message.sender_id !== user.id || message.kind !== "text" || message.deleted_at) {
    return reply(404, { error: "That message can't start an agent reply.", code: "not_found" });
  }

  const [{ data: conversation }, { data: repliedTo }] = await Promise.all([
    supabase.from("conversations").select("id, workspace_id, agent_id").eq("id", message.conversation_id).maybeSingle(),
    message.reply_to_id
      ? supabase.from("messages").select("agent_id").eq("id", message.reply_to_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  if (!conversation) return reply(404, { error: "Conversation not found.", code: "not_found" });

  const handles = extractMentionHandles(message.body, MAX_AGENTS_PER_MESSAGE + 2);
  const repliedAgentId = repliedTo?.agent_id ?? null;
  if (!conversation.agent_id && !repliedAgentId && handles.length === 0) return reply(200, { runs: [] });

  // Ids come from the database and handles only ever contain [a-z0-9-], so they are safe inside the filter.
  const clauses = [
    ...[conversation.agent_id, repliedAgentId].filter((id): id is string => Boolean(id)).map((id) => `id.eq.${id}`),
    ...(handles.length > 0 ? [`handle.in.(${handles.join(",")})`] : []),
  ];
  const { data: found, error: agentsError } = await supabase
    .from("ai_agents")
    .select("*")
    .eq("workspace_id", conversation.workspace_id)
    .is("archived_at", null)
    .or(clauses.join(","));
  if (agentsError) {
    log.error("agent lookup failed", { error: agentsError });
    return startError(undefined);
  }

  // Same order as the composer shows: the room's agent, the agent replied to, then mentions.
  const ordered: Tables<"ai_agents">[] = [];
  const add = (agent: Tables<"ai_agents"> | undefined) => {
    if (agent && !ordered.includes(agent)) ordered.push(agent);
  };
  add((found ?? []).find((agent) => agent.id === conversation.agent_id));
  add((found ?? []).find((agent) => agent.id === repliedAgentId));
  for (const handle of handles) add((found ?? []).find((agent) => agent.handle === handle));
  const agents = ordered.slice(0, MAX_AGENTS_PER_MESSAGE);
  if (agents.length === 0) return reply(200, { runs: [] });

  const available = configuredModels();
  if (!serverEnv.hasServiceRoleKey || available.length === 0) {
    log.error("AI is not configured: set SUPABASE_SERVICE_ROLE_KEY and at least one provider key");
    return unavailable();
  }

  const admin = createSupabaseAdminClient();
  const [{ error: staleError }, { data: wallet }] = await Promise.all([
    admin.rpc("ai_fail_stale_runs", { p_workspace_id: conversation.workspace_id }),
    admin.from("ai_wallets").select("balance").eq("user_id", user.id).maybeSingle(),
  ]);
  if (staleError) log.warn("stale run cleanup failed", { error: staleError });
  if (!wallet || wallet.balance < 1) return startError("P0402");

  const runs: Array<{ runId: string; messageId: string; agentId: string; model: string; created: boolean }> = [];
  const work: Array<Parameters<typeof runAgentReply>[0]> = [];

  for (const agent of agents) {
    const decision = routeModel({
      text: message.body,
      specialty: toSpecialty(agent.specialty),
      style: toResponseStyle(agent.response_style),
      mode: agent.model_mode === "fixed" ? "fixed" : "auto",
      agentModel: agent.model,
      override: parsed.data.model,
      wantsWeb: agent.tools.includes("web"),
      balance: wallet.balance,
      available,
    });
    if (!decision) continue;

    const { data, error } = await admin.rpc("ai_start_reply_run", {
      p_user_id: user.id,
      p_trigger_message_id: message.id,
      p_agent_id: agent.id,
      p_model: decision.model.id,
      // In shared chats the reply quotes the question; an agent's own room doesn't need it.
      p_quote: !conversation.agent_id,
      p_route: { mode: decision.mode, tier: decision.tier, complexity: decision.complexity, reason: decision.reason },
    });
    const started = data?.[0];

    if (error || !started) {
      log.warn("agent run refused", { agentId: agent.id, error });
      if (runs.length === 0 && (error?.code === "P0402" || error?.code === "P0429")) return startError(error.code);
      continue;
    }

    runs.push({
      runId: started.o_run_id,
      messageId: started.o_reply_message_id,
      agentId: agent.id,
      model: decision.model.id,
      created: started.o_created,
    });
    if (started.o_created) {
      work.push({
        runId: started.o_run_id,
        replyMessageId: started.o_reply_message_id,
        triggerMessageId: message.id,
        conversationId: started.o_conversation_id,
        workspaceId: started.o_workspace_id,
        userId: user.id,
        agent,
        model: decision.model,
      });
    }
  }

  if (runs.length === 0) return startError(undefined);

  if (work.length > 0) {
    after(async () => {
      await Promise.all(
        work.map((input) => runAgentReply(input).catch((error) => log.error("agent run crashed", { runId: input.runId, error }))),
      );
    });
  }

  return reply(202, { runs });
}
