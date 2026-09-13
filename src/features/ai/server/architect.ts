import "server-only";

import { logger } from "@/lib/logger";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

import {
  ARCHITECT_JSON_SCHEMA,
  architectOutputSchema,
  HANDLE_PATTERN,
  normalizeDraft,
  type AgentDraft,
} from "../agent-spec";
import { creditsForUsage, estimateReservation, estimateTokens } from "../credits";
import { findModel, pickArchitectModel, type AiModel } from "../models";
import type { AdminClient } from "./directory";
import { configuredModels } from "./env";
import { AgentRunError } from "./errors";
import { providerClient } from "./providers";
import type { StepUsage } from "./providers/types";

const MAX_OUTPUT_TOKENS = 4000;

const log = logger.child({ module: "agent-architect" });

export const ARCHITECT_SYSTEM = `You design AI agents for maeosan, a team chat app for small companies. A teammate describes, in their own words, an agent they want. You turn that description into a complete agent that is ready to use.

What an agent in maeosan is:
- It lives in the team's chat. People @mention it in any conversation, or talk to it one-to-one in its own room.
- Each time it replies, it sees the recent messages of the conversation it was called into and the message that called it.
- It can only reply in chat. It can't send email, schedule meetings, edit files or act in other tools, so its instructions must never promise that.
- Optional tools, enabled per agent:
  - history: read older messages in the same conversation.
  - search: search messages from other chats, limited to what everyone in the current chat can already see.
  - directory: list the workspace's members with their titles and roles.
  - web: search the web. It costs extra, so include it only when the job needs current information from outside the team.

How to fill each field:
- name: one or two words that suit the job and are easy to @mention. Avoid generic names like "Assistant" or "AI Helper", and never use a real person's name.
- handle: the name in lowercase for @mentions: 3 to 24 letters, digits or dashes, starting with a letter.
- tagline: one plain sentence under 100 characters saying what it does for the team.
- instructions: 120 to 400 words written to the agent as "you". Cover its job and who it helps; what a great reply looks like, including format and length for a chat message; when to use each enabled tool; what to do when information is missing (ask one short question, or say plainly what is unknown); and firm boundaries. Be concrete and specific to the job. Skip generic chat etiquette, because maeosan adds that itself.
- tools: only the tools the job needs.
- starters: two or three short messages a teammate might really send it, written in the teammate's voice.
- color and glyph: choose what fits the agent's character. Glyphs: orbit for research and finding things, prism for analysis and clarity, wave for writing and tone, spark for ideas and energy, grid for planning and structure, bloom for people and support.
- tier: fast for quick lookups and short rewrites, balanced for most everyday work, deep for careful multi-step reasoning, analysis or long-form writing.

If the description is vague, make sensible choices for a small team instead of asking questions. When a current draft is included, apply the requested change and keep everything else that still fits. If the description asks for something harmful, design an agent that helps with the legitimate goal and declines the harmful part.`;

function pickModel(): AiModel {
  const model = pickArchitectModel(configuredModels());
  if (!model) {
    throw new AgentRunError(
      "No AI provider is connected yet. Add ANTHROPIC_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY or DEEPSEEK_API_KEY on the server.",
      "unavailable",
    );
  }
  return model;
}

/** Keeps the suggested handle free: scout → scout-2 → scout-3… */
export function uniqueHandle(handle: string, taken: ReadonlySet<string>) {
  if (!taken.has(handle)) return handle;
  for (let suffix = 2; suffix < 100; suffix += 1) {
    const tail = `-${suffix}`;
    const candidate = `${handle.slice(0, 24 - tail.length).replace(/-+$/, "")}${tail}`;
    if (HANDLE_PATTERN.test(candidate) && !taken.has(candidate)) return candidate;
  }
  return handle;
}

async function workspaceContext(admin: AdminClient, workspaceId: string) {
  const [workspace, agents] = await Promise.all([
    admin.from("workspaces").select("name, team_size, use_case").eq("id", workspaceId).single(),
    admin.from("ai_agents").select("name, handle, tagline").eq("workspace_id", workspaceId).is("archived_at", null),
  ]);
  if (workspace.error) throw workspace.error;
  return { workspace: workspace.data, agents: agents.data ?? [] };
}

function buildPrompt(
  request: string,
  current: AgentDraft | null,
  context: Awaited<ReturnType<typeof workspaceContext>>,
) {
  const { workspace, agents } = context;
  const about = [workspace.use_case && `team type: ${workspace.use_case}`, workspace.team_size && `team size: ${workspace.team_size}`]
    .filter(Boolean)
    .join(", ");
  const existing = agents.length
    ? agents.map((agent) => `- ${agent.name} (@${agent.handle})${agent.tagline ? `: ${agent.tagline}` : ""}`).join("\n")
    : "None yet.";

  return `Workspace: "${workspace.name}"${about ? ` (${about})` : ""}

Agents already in this workspace, so the new one should complement them and use a different handle:
${existing}
${current ? `\nThe current draft, to revise according to the request:\n<draft>\n${JSON.stringify(current, null, 2)}\n</draft>\n` : ""}
The teammate's request:
<request>
${request}
</request>`;
}

function startFailure(code: string | undefined) {
  if (code === "P0402") return new AgentRunError("This workspace is out of AI credits.", "out_of_credits");
  if (code === "P0429") return new AgentRunError("You're drafting agents quickly. Give it a minute.", "invalid");
  return new AgentRunError("Couldn't start drafting. Try again.", "invalid");
}

export interface BlueprintResult {
  draft: AgentDraft;
  model: string;
  credits: number;
}

/** Turns a plain-language description into an agent draft, billed to the workspace like any run. */
export async function draftAgentBlueprint(input: {
  userId: string;
  workspaceId: string;
  prompt: string;
  current: AgentDraft | null;
}): Promise<BlueprintResult> {
  const model = pickModel();
  const admin = createSupabaseAdminClient();

  const { data: runId, error: startError } = await admin.rpc("ai_start_architect_run", {
    p_user_id: input.userId,
    p_workspace_id: input.workspaceId,
    p_model: model.id,
  });
  if (startError || !runId) throw startFailure(startError?.code);

  let usage: StepUsage | null = null;
  try {
    const context = await workspaceContext(admin, input.workspaceId);
    const prompt = buildPrompt(input.prompt, input.current, context);

    const reservation = estimateReservation(model, {
      inputTokens: estimateTokens(ARCHITECT_SYSTEM + prompt + JSON.stringify(ARCHITECT_JSON_SCHEMA)),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    });
    const { data: held, error: holdError } = await admin.rpc("ai_reserve_credits", { p_run_id: runId, p_amount: reservation });
    if (holdError) throw holdError;
    if (!held) throw new AgentRunError("This workspace is out of AI credits.", "out_of_credits");

    const result = await providerClient(model.provider).generateObject({
      model,
      system: ARCHITECT_SYSTEM,
      prompt,
      jsonSchema: ARCHITECT_JSON_SCHEMA,
      parse: (value) => normalizeDraft(architectOutputSchema.parse(value)),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      signal: AbortSignal.timeout(55_000),
    });
    usage = result.usage;

    const draft = {
      ...result.value,
      handle: uniqueHandle(result.value.handle, new Set(context.agents.map((agent) => agent.handle))),
    };
    const credits = creditsForUsage(model, usage);
    await admin.rpc("ai_settle_credits", {
      p_run_id: runId,
      p_credits: credits,
      p_input_tokens: usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens,
      p_output_tokens: usage.outputTokens,
    });
    await admin.rpc("ai_finish_run", { p_run_id: runId, p_status: "succeeded" });
    return { draft, model: model.id, credits };
  } catch (error) {
    log.warn("architect failed", { runId, error });
    const credits = usage ? creditsForUsage(model, usage) : 0;
    await admin.rpc("ai_settle_credits", { p_run_id: runId, p_credits: credits });
    await admin.rpc("ai_finish_run", {
      p_run_id: runId,
      p_status: "failed",
      p_error: error instanceof Error ? error.message.slice(0, 300) : "Drafting failed.",
    });
    if (error instanceof AgentRunError) throw error;
    if (error instanceof SyntaxError || (error instanceof Error && error.name === "ZodError")) {
      throw new AgentRunError("The model returned an incomplete draft. Try again.", "invalid");
    }
    throw error;
  }
}

export function isKnownModel(id: string) {
  return findModel(id) !== null;
}
