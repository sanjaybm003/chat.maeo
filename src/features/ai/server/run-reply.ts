import "server-only";

import { logger } from "@/lib/logger";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { pluralize } from "@/lib/utils";
import type { Json } from "@/types/database";
import type { AgentRunStep } from "@/types/domain";

import type { AgentToolId } from "../agent-spec";
import { creditsForUsage, estimateReservation, estimateTokens, type TokenUsage } from "../credits";
import type { AiModel } from "../models";
import { fallbackModel } from "../router";
import { SPECIALTY_PROFILES, toSpecialty } from "../specialties";
import { isModelRefused, MAX_MODEL_ATTEMPTS, worthAnotherModel } from "./availability";
import { buildReplyContext, type AgentRow } from "./context";
import type { AdminClient } from "./directory";
import { AgentRunError, describeFailure, friendlyRunError, RunCancelledError, RunDeadlineError } from "./errors";
import { configuredModels, isProviderConfigured } from "./env";
import { providerClient } from "./providers";
import type { StepResult } from "./providers/types";
import { StreamPublisher } from "./publisher";
import { describeToolCall, executeTool, TOOL_SPECS, type ToolContext } from "./tools";

const REPLY_MAX_OUTPUT_TOKENS = 12_000;
const MAX_MODEL_CALLS = 6;
const WEB_SEARCHES_PER_CALL = 3;
/** Stays well inside the route's 300s maxDuration, leaving time to save. */
const RUN_DEADLINE_MS = 240_000;
const CANCEL_POLL_MS = 1_200;
const MAX_REPLY_CHARS = 16_000;

export interface ReplyRunInput {
  runId: string;
  replyMessageId: string;
  triggerMessageId: string;
  conversationId: string;
  workspaceId: string;
  userId: string;
  agent: AgentRow;
  /** Chosen by the router for this reply. */
  model: AiModel;
}

const joinText = (before: string, next: string) => (before && next ? `${before}\n\n${next}` : before || next);

async function reserve(admin: AdminClient, runId: string, amount: number, minimum: number) {
  const { data, error } = await admin.rpc("ai_reserve_credits", { p_run_id: runId, p_amount: amount, p_minimum: minimum });
  if (error) throw error;
  return data ?? 0;
}

async function settle(admin: AdminClient, runId: string, credits: number, usage: TokenUsage | null, toolCalls: number) {
  const { error } = await admin.rpc("ai_settle_credits", {
    p_run_id: runId,
    p_credits: credits,
    p_input_tokens: usage ? usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0) : 0,
    p_output_tokens: usage?.outputTokens ?? 0,
    p_tool_calls: toolCalls,
  });
  if (error) throw error;
}

/**
 * Runs one agent reply end to end: context → model calls with tools → live
 * stream → credits held and settled per call from the asker's wallet → final
 * message saved. When the AI account can't use the routed model, another
 * available model answers instead, as long as nothing has reached the chat.
 * Always finishes the run, whatever happens, so no reply is left spinning.
 */
export async function runAgentReply(input: ReplyRunInput): Promise<void> {
  const log = logger.child({ module: "agent-run", runId: input.runId, agentId: input.agent.id, model: input.model.id });
  const admin = createSupabaseAdminClient();
  const publisher = new StreamPublisher(admin, {
    conversationId: input.conversationId,
    messageId: input.replyMessageId,
    runId: input.runId,
  });
  const controller = new AbortController();
  const steps: AgentRunStep[] = [];
  const startedAt = Date.now();
  const specialty = toSpecialty(input.agent.specialty);
  /** The routed model, until the account turns it away and another stands in. */
  let model = input.model;
  const tried = new Set([model.id]);

  let text = "";
  let status: "succeeded" | "failed" | "cancelled" = "succeeded";
  let errorMessage: string | null = null;
  /** The provider's own reason, kept on the asker's private run record, never in the chat. */
  let errorDetail: string | null = null;
  let poller: ReturnType<typeof setInterval> | undefined;

  const addStep = (step: AgentRunStep) => {
    steps.push(step);
    publisher.addStep(step);
  };

  try {
    if (!isProviderConfigured(model.provider)) {
      log.error("provider key missing for routed model");
      throw new AgentRunError("This model isn’t available right now. Try again, or pick another model.", "unavailable");
    }

    poller = setInterval(() => {
      if (Date.now() - startedAt > RUN_DEADLINE_MS) {
        controller.abort(new RunDeadlineError());
        return;
      }
      void admin
        .from("ai_runs")
        .select("cancel_requested")
        .eq("id", input.runId)
        .single()
        .then(({ data }) => {
          if (data?.cancel_requested) controller.abort(new RunCancelledError());
        });
    }, CANCEL_POLL_MS);

    const context = await buildReplyContext(admin, input);
    addStep({ kind: "read", label: `Read ${pluralize(context.messageCount, "message")}` });
    if (context.relatedCount > 0) {
      addStep({ kind: "tool", label: `Found ${pluralize(context.relatedCount, "related message")} in other chats` });
    }

    const tools = (input.agent.tools as AgentToolId[]).flatMap((id) => (id === "web" ? [] : [TOOL_SPECS[id]]));
    const wantsWeb = input.agent.tools.includes("web");
    let webSearch = wantsWeb && model.webSearch !== null;
    const openSession = () =>
      providerClient(model.provider).createSession({
        model,
        system: context.system,
        userMessage: context.userMessage,
        tools,
        webSearch,
        maxOutputTokens: REPLY_MAX_OUTPUT_TOKENS,
        temperature: SPECIALTY_PROFILES[specialty].temperature,
      });
    let session = openSession();

    /** Another model to answer with, when the failure is this model's account trouble rather than the request. */
    const standInFor = (error: unknown) =>
      !controller.signal.aborted && worthAnotherModel(error) && tried.size < MAX_MODEL_ATTEMPTS
        ? fallbackModel(model, specialty, configuredModels().filter((item) => !isModelRefused(item.id)), tried)
        : null;

    const toolContext: ToolContext = {
      admin,
      directory: context.directory,
      workspaceId: input.workspaceId,
      conversationId: input.conversationId,
      userId: input.userId,
      oldestLoadedAt: context.oldestLoadedAt,
    };

    let promptTokens = estimateTokens(context.system + context.userMessage);

    for (let call = 0; call < MAX_MODEL_CALLS; call += 1) {
      const held = await reserve(
        admin,
        input.runId,
        estimateReservation(model, {
          inputTokens: promptTokens,
          maxOutputTokens: REPLY_MAX_OUTPUT_TOKENS,
          webSearches: webSearch ? WEB_SEARCHES_PER_CALL : 0,
        }),
        estimateReservation(model, { inputTokens: promptTokens, maxOutputTokens: 1024 }),
      );
      if (held === 0) throw new AgentRunError("You’re out of AI credits.", "out_of_credits");

      let streamed = "";
      let result: StepResult | null = null;
      let standIn: AiModel | null = null;
      try {
        result = await session.step({
          signal: controller.signal,
          onText: (delta) => {
            streamed += delta;
            publisher.setText(joinText(text, streamed));
          },
          onActivity: addStep,
        });
      } catch (error) {
        standIn = call === 0 && !streamed ? standInFor(error) : null;
        if (!standIn) throw error;
        log.warn("the account can't use this model; another model is answering", {
          from: model.id,
          to: standIn.id,
          detail: describeFailure(error),
        });
      } finally {
        // A call that failed mid-answer was still billed by the provider for what it streamed.
        const usage: TokenUsage | null =
          result?.usage ?? (streamed ? { inputTokens: promptTokens, outputTokens: estimateTokens(streamed) } : null);
        // If the account couldn't use the chosen model, another one answered: bill what actually ran.
        const billed = result?.billedModel ?? model;
        try {
          await settle(admin, input.runId, usage ? creditsForUsage(billed, usage) : 0, usage, result?.toolCalls.length ?? 0);
        } catch (settleError) {
          // Billing trouble must never hide why the call itself failed.
          if (result) throw settleError;
          log.error("could not settle credits for a failed call", { error: settleError });
        }
      }

      if (!result) {
        // Only a failure another model can get past reaches here; every other one was rethrown.
        if (!standIn) break;
        tried.add(standIn.id);
        model = standIn;
        webSearch = wantsWeb && model.webSearch !== null;
        session = openSession();
        const { error: modelError } = await admin.from("ai_runs").update({ model: model.id }).eq("id", input.runId);
        if (modelError) log.warn("could not record the stand-in model", { error: modelError });
        // The stand-in starts fresh, with every call still ahead of it.
        call -= 1;
        continue;
      }

      text = joinText(text, result.text || streamed);
      publisher.setText(text);
      promptTokens += result.usage.outputTokens;

      if (result.outcome === "tool_calls") {
        const outputs = await Promise.all(
          result.toolCalls.map((toolCall) => {
            addStep(describeToolCall(toolCall));
            return executeTool(toolCall, toolContext);
          }),
        );
        session.addToolResults(outputs);
        promptTokens += outputs.reduce((sum, output) => sum + estimateTokens(output.output), 0);
        if (call === MAX_MODEL_CALLS - 1) {
          text = joinText(text, "_I ran out of steps before finishing. Ask me to keep going._");
        }
        continue;
      }
      if (result.outcome === "continue") continue;
      if (result.outcome === "refused" && !text.trim()) text = "I can't help with that one.";
      if (result.outcome === "max_tokens") text = joinText(text, "_I hit my length limit. Ask me to continue._");
      break;
    }

    if (!text.trim()) text = "I don't have anything to add here.";
  } catch (error) {
    const reason: unknown = controller.signal.aborted ? controller.signal.reason : null;
    if (reason instanceof RunCancelledError) {
      status = "cancelled";
    } else if (reason instanceof RunDeadlineError) {
      status = text.trim() ? "succeeded" : "failed";
      text = joinText(text, "_I took too long and stopped here._");
      errorMessage = text.trim() ? null : "The reply took too long.";
    } else {
      status = "failed";
      errorMessage = friendlyRunError(error);
      errorDetail = describeFailure(error);
      log.warn("agent reply failed", { error });
    }
  } finally {
    clearInterval(poller);
    await publisher.close();
    const { error } = await admin.rpc("ai_finish_run", {
      p_run_id: input.runId,
      p_status: status,
      p_body: text.slice(0, MAX_REPLY_CHARS),
      p_steps: steps as unknown as Json,
      p_error: errorMessage,
    });
    if (error) log.error("could not save the agent reply", { error });
    if (!error && status === "failed" && errorDetail && errorDetail !== errorMessage) {
      const { error: detailError } = await admin
        .from("ai_runs")
        .update({ error: `${errorMessage} (${errorDetail})`.slice(0, 500) })
        .eq("id", input.runId);
      if (detailError) log.warn("could not record why the reply failed", { error: detailError });
    }
  }
}
