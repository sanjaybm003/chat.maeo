import "server-only";

import { logger } from "@/lib/logger";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { pluralize } from "@/lib/utils";
import type { Json } from "@/types/database";
import type { AgentRunStep, Specialty } from "@/types/domain";

import { creditsForUsage, estimateReservation, estimateTokens, type TokenUsage } from "../credits";
import { describeNow } from "../lib/time";
import { arrangeSources, collectSources } from "../lib/reply-sources";
import { unverifiedLinks } from "../lib/web-evidence";
import type { AiModel } from "../models";
import { fallbackModel } from "../router";
import { SPECIALTY_PROFILES, toSpecialty } from "../specialties";
import { isModelRefused, MAX_MODEL_ATTEMPTS, worthAnotherModel } from "./availability";
import { buildReplyContext, type AgentRow } from "./context";
import type { AdminClient } from "./directory";
import { AgentRunError, describeFailure, friendlyRunError, RunCancelledError, RunDeadlineError } from "./errors";
import { configuredModels, isProviderConfigured } from "./env";
import { loadGithubAccess } from "./github-tools";
import { runPreflight } from "./preflight";
import { providerClient } from "./providers";
import type { ReasoningEffort, StepResult, ToolResult } from "./providers/types";
import { StreamPublisher } from "./publisher";
import { reviewReply } from "./review";
import { describeToolCall, executeTool, toolsFor, type ToolBilling, type ToolContext } from "./tools";
import type { WebDepth, WebSource } from "./web";

const REPLY_MAX_OUTPUT_TOKENS = 12_000;
const REVIEW_MAX_OUTPUT_TOKENS = 6_000;
const WEB_SEARCHES_PER_CALL = 3;
/** Stays well inside the route's 300s maxDuration, leaving time to save. */
const RUN_DEADLINE_MS = 240_000;
/** A double-check only starts with at least this much of the deadline left. */
const REVIEW_TIME_MS = 45_000;
const CANCEL_POLL_MS = 1_200;
const MAX_REPLY_CHARS = 16_000;
const MAX_EVIDENCE_CHARS = 3_000;

/** Tools that only read: asking the same thing twice in one reply reuses the first answer. */
const REUSABLE_TOOLS = new Set([
  "search_workspace_messages",
  "list_workspace_members",
  "search_web",
  "read_web_page",
  "list_tasks",
  "github_list_repositories",
  "github_list_files",
  "github_read_file",
  "github_search_code",
]);
/** After one of these changes something, earlier reads may be out of date. */
const CHANGING_TOOLS = new Set(["create_task", "update_task", "github_open_pull_request"]);
const LAST_STEP_NOTE = "\n\n(This is your last step: answer now with what you have, without calling more tools.)";

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
  /** How demanding the message is, from 0 to 1, as routing scored it. */
  complexity: number;
  /** The asker's time zone. */
  timeZone: string;
  /** Other agents answering the same message. */
  coworkers: Array<{ name: string; handle: string }>;
  triggerBody: string;
  triggerReplyToId: string | null;
}

/** Working in code takes more rounds of reading than a quick answer does. */
export function modelCallBudget(tools: readonly string[]) {
  if (tools.includes("github")) return 16;
  if (tools.includes("tasks") || tools.includes("web")) return 8;
  return 6;
}

/** The agent's creativity setting moves its specialty's usual temperature. */
export function temperatureFor(agent: Pick<AgentRow, "specialty" | "creativity">) {
  const base = SPECIALTY_PROFILES[toSpecialty(agent.specialty)].temperature;
  if (agent.creativity === "precise") return Math.min(base, 0.15);
  if (agent.creativity === "creative") return Math.min(1, Math.max(base + 0.3, 0.85));
  return base;
}

/** Quick questions get a quick think; hard questions and code get a longer one. */
export function effortFor(complexity: number, tools: readonly string[]): ReasoningEffort {
  if (complexity >= 0.68) return "high";
  return complexity >= 0.4 || tools.includes("github") ? "medium" : "low";
}

/** Research, and anything demanding, reads its top sources instead of relying on a search summary. */
export function webDepthFor(specialty: Specialty, complexity: number): WebDepth {
  return specialty === "research" || complexity >= 0.55 ? "deep" : "quick";
}

/**
 * Whether a finished reply gets a second read: always when the agent is set to
 * double-check, and otherwise when it cites links that nothing it read
 * contains, or answers anything beyond a quick question from the web, where a
 * misread page is the likeliest way to be wrong.
 */
export function shouldVerify({
  doubleCheck,
  suspiciousLinks,
  usedWeb,
  complexity,
}: {
  doubleCheck: boolean;
  suspiciousLinks: number;
  usedWeb: boolean;
  complexity: number;
}) {
  return doubleCheck || suspiciousLinks > 0 || (usedWeb && complexity >= 0.4);
}

/** Same arguments in any key order give the same key. */
export function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
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
 * Runs one agent reply end to end: the conversation, attachments, linked pages,
 * mentioned tasks and any obvious web research load together → model calls
 * with tools → live stream → credits held and settled per call from the
 * asker's wallet → a second read when the agent asks for one or the reply
 * cites links nothing backs → a source line for answers from the web → final
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
  const today = describeNow(input.timeZone);
  const webDepth = webDepthFor(specialty, input.complexity);
  /** Every source the web returned for this reply, for its source line. */
  const webSources: WebSource[] = [];
  /** Deliveries to connected apps that tools started; the run waits for them after the reply is saved. */
  const background: Promise<unknown>[] = [];
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

    // Paid work, like a web search, is held and settled on the same run as the model calls.
    const billing: ToolBilling = {
      hold: async (credits) => (await reserve(admin, input.runId, credits, credits)) > 0,
      settle: (credits) => settle(admin, input.runId, credits, null, 0),
    };

    const wantsWeb = input.agent.tools.includes("web");
    let webSearch = wantsWeb && model.webSearch !== null;

    const context = await buildReplyContext(admin, {
      ...input,
      github: input.agent.tools.includes("github") ? loadGithubAccess(admin, input.workspaceId) : Promise.resolve(null),
      preflight: runPreflight({
        admin,
        workspaceId: input.workspaceId,
        triggerMessageId: input.triggerMessageId,
        triggerReplyToId: input.triggerReplyToId,
        text: input.triggerBody,
        tools: input.agent.tools,
        nativeWebSearch: webSearch,
        depth: webDepth,
        today,
        billing,
        signal: controller.signal,
      }).catch((error: unknown) => {
        if (controller.signal.aborted) throw error;
        log.warn("pre-flight failed; the agent can still use its tools", { detail: describeFailure(error) });
        return null;
      }),
    });
    const { github } = context;
    addStep({ kind: "read", label: `Read ${pluralize(context.messageCount, "message")}` });
    if (context.relatedCount > 0) {
      addStep({ kind: "tool", label: `Found ${pluralize(context.relatedCount, "related message")} in other chats` });
    }
    for (const step of context.preflight?.steps ?? []) addStep(step);
    webSources.push(...(context.preflight?.web?.sources ?? []));

    const effort = effortFor(input.complexity, input.agent.tools);
    const openSession = () =>
      providerClient(model.provider).createSession({
        model,
        system: context.system,
        userMessage: context.userMessage,
        tools: toolsFor(input.agent.tools, { nativeWebSearch: webSearch, github }),
        webSearch,
        maxOutputTokens: REPLY_MAX_OUTPUT_TOKENS,
        temperature: temperatureFor(input.agent),
        effort,
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
      agentId: input.agent.id,
      agentName: input.agent.name,
      timeZone: input.timeZone,
      today,
      webDepth,
      webSources,
      background,
      oldestLoadedAt: context.oldestLoadedAt,
      github,
      billing,
      signal: controller.signal,
    };

    /** What the tools returned, for the double-check to hold the reply against. */
    const evidence: string[] = [...(context.preflight?.evidence ?? [])];
    /** Everything the agent read in full, for checking the links its reply cites. */
    const material: string[] = [context.system, context.userMessage];
    const toolResults = new Map<string, Promise<ToolResult>>();
    const maxCalls = modelCallBudget(input.agent.tools);
    let promptTokens = estimateTokens(context.system + context.userMessage);
    let finishedCleanly = false;

    const runTool = async (toolCall: Parameters<typeof executeTool>[0]) => {
      const key = REUSABLE_TOOLS.has(toolCall.name) ? `${toolCall.name}:${stableJson(toolCall.input)}` : null;
      const earlier = key ? toolResults.get(key) : undefined;
      if (earlier) return { ...(await earlier), callId: toolCall.id };
      addStep(describeToolCall(toolCall));
      const running = executeTool(toolCall, toolContext);
      if (key) toolResults.set(key, running);
      const output = await running;
      if (CHANGING_TOOLS.has(toolCall.name)) toolResults.clear();
      return output;
    };

    for (let call = 0; call < maxCalls; call += 1) {
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
        const outputs = await Promise.all(result.toolCalls.map(runTool));
        for (const output of outputs) {
          if (output.isError) continue;
          evidence.push(`${output.name}:\n${output.output.slice(0, MAX_EVIDENCE_CHARS)}`);
          material.push(output.output);
        }
        // Nudge a model that keeps reaching for tools to answer while it still can.
        if (call === maxCalls - 2 && outputs.length > 0) {
          const last = outputs.length - 1;
          outputs[last] = { ...outputs[last], output: `${outputs[last].output}${LAST_STEP_NOTE}` };
        }
        session.addToolResults(outputs);
        promptTokens += outputs.reduce((sum, output) => sum + estimateTokens(output.output), 0);
        if (call === maxCalls - 1) {
          text = joinText(text, "_I ran out of steps before finishing. Ask me to keep going._");
        }
        continue;
      }
      if (result.outcome === "continue") continue;
      if (result.outcome === "refused" && !text.trim()) text = "I can't help with that one.";
      if (result.outcome === "max_tokens") text = joinText(text, "_I hit my length limit. Ask me to continue._");
      finishedCleanly = result.outcome === "done";
      break;
    }

    const doubleCheck = async (draft: string, suspicious: readonly string[]) => {
      addStep({
        kind: "note",
        label: input.agent.double_check
          ? "Double-checking the answer"
          : suspicious.length > 0
            ? "Checking the links in the answer"
            : "Checking the answer against its sources",
      });
      const inputTokens = estimateTokens(context.userMessage + evidence.join("\n") + draft) + 1500;
      const held = await reserve(
        admin,
        input.runId,
        estimateReservation(model, { inputTokens, maxOutputTokens: REVIEW_MAX_OUTPUT_TOKENS }),
        estimateReservation(model, { inputTokens, maxOutputTokens: 512 }),
      );
      if (held === 0) return draft;

      let review: Awaited<ReturnType<typeof reviewReply>> | null = null;
      try {
        review = await reviewReply({
          model,
          rules: input.agent.rules ?? "",
          request: context.userMessage,
          evidence,
          draft,
          concerns:
            suspicious.length > 0
              ? [
                  `These links in the draft weren't found in the conversation or the evidence, so they may not exist: ${suspicious.join(", ")}. Remove each one, or replace it with a link from the evidence.`,
                ]
              : [],
          today,
          signal: controller.signal,
          maxOutputTokens: REVIEW_MAX_OUTPUT_TOKENS,
          effort: "medium",
        });
      } catch (error) {
        if (controller.signal.aborted) throw error;
        log.warn("double-check failed; keeping the draft", { detail: describeFailure(error) });
      } finally {
        await settle(admin, input.runId, review ? creditsForUsage(review.model, review.usage) : 0, review?.usage ?? null, 0).catch(
          (error: unknown) => log.error("could not settle the double-check", { error }),
        );
      }

      if (review?.verdict === "revise" && review.reply.trim().length >= Math.min(40, draft.length / 2)) {
        const corrected = review.reply.trim();
        publisher.setText(corrected);
        addStep({
          kind: "note",
          label: review.issues.length > 0 ? `Double-checked: fixed ${pluralize(review.issues.length, "issue")}` : "Double-checked and tightened",
        });
        return corrected;
      }
      if (review) addStep({ kind: "note", label: "Double-checked" });
      return draft;
    };

    if (!text.trim()) {
      text = "I don't have anything to add here.";
    } else if (finishedCleanly) {
      const suspicious = unverifiedLinks(text, material);
      const usedWeb = webSources.length > 0;
      if (suspicious.length > 0) log.info("reply cites links nothing it read contains", { links: suspicious });
      const verify = shouldVerify({ doubleCheck: input.agent.double_check, suspiciousLinks: suspicious.length, usedWeb, complexity: input.complexity });
      if (verify && Date.now() - startedAt < RUN_DEADLINE_MS - REVIEW_TIME_MS) text = await doubleCheck(text, suspicious);
      // Links the agent read become numbered sources under the reply; links nothing backs up lose their address.
      const arranged = arrangeSources(text, { known: collectSources(material, webSources), fallback: usedWeb ? webSources : [] }).text;
      if (arranged !== text) {
        text = arranged;
        publisher.setText(text);
      }
    }
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
    // The reply is saved; now let connected apps finish hearing about any task changes.
    await Promise.allSettled(background);
  }
}
