import "server-only";

import { logger } from "@/lib/logger";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import type { Specialty } from "@/types/domain";

import {
  ARCHITECT_JSON_SCHEMA,
  architectOutputSchema,
  HANDLE_PATTERN,
  normalizeDraft,
  type AgentDraft,
} from "../agent-spec";
import { creditsForUsage, estimateReservation, estimateTokens } from "../credits";
import { architectCandidates, pickArchitectModel, type AiModel } from "../models";
import { SPECIALTY_PROFILES } from "../specialties";
import { isModelRefused, MAX_MODEL_ATTEMPTS, worthAnotherModel } from "./availability";
import type { AdminClient } from "./directory";
import { configuredModels } from "./env";
import { AgentRunError } from "./errors";
import { providerClient, ProviderError } from "./providers";
import type { StepUsage } from "./providers/types";

const MAX_OUTPUT_TOKENS = 4000;

const log = logger.child({ module: "agent-architect" });

export const ARCHITECT_SYSTEM = `You design AI agents for maeosan, a team chat app for small companies. A teammate describes, in their own words, an agent they want. You turn that description into a complete, specialized agent that is ready to use.

What an agent in maeosan is:
- It lives in the team's chat. People @mention it in any conversation, add it to a chat so it works alongside the team, or talk to it one-to-one in its own room.
- Each time it replies, it reads the most relevant recent messages of the conversation it was called into and the message that called it.
- It can only reply in chat. It can't send email, schedule meetings, edit files or act in other tools, so its instructions must never promise that.
- A model is picked automatically for each message, from fast to deep, based on what is asked. You don't choose the model.
- Optional tools, enabled per agent:
  - history: read older messages in the same conversation.
  - search: search messages from other chats, limited to what everyone in the current chat can already see.
  - directory: list the workspace's members with their titles and roles.
  - web: search the web and read pages. Include it only when the job needs current information from outside the team.
  - tasks: check, create and update the team's tasks. Include it for agents that plan, coordinate or follow up on work.
  - github: read code in the workspace's connected GitHub repositories and open pull requests. Include it only for engineering agents that should work on code.

How to fill each field:
- specialty: the kind of work that fits best. assistant for everyday help; research for finding and verifying facts; writing for drafting and editing; analysis for numbers, options and trade-offs; planning for turning discussion into plans and next steps; support for helping people solve problems; engineering for code and technical questions. Each specialty comes with a proven working method, so don't restate generic method in the instructions.
- name: one or two words that suit the job and are easy to @mention. Avoid generic names like "Assistant" or "AI Helper", and never use a real person's name.
- handle: the name in lowercase for @mentions: 3 to 24 letters, digits or dashes, starting with a letter.
- tagline: one plain sentence under 100 characters saying what it does for the team.
- instructions: 120 to 400 words written to the agent as "you". Make them specific to this team's job: who it helps and with what, what a great reply looks like for this job (structure, what to always include, what to leave out), when to use each enabled tool, what to do when information is missing, and firm boundaries. Be concrete; prefer examples of the exact output format over adjectives.
- knowledge: copy any facts the teammate gave (product names, prices, policies, links, people's roles, schedules) as short reference lines. Leave it empty if they gave none. Never invent facts.
- responseStyle: concise for quick answers, balanced for most agents, detailed when replies need depth.
- tools: only the tools the job needs.
- starters: two or three short messages a teammate might really send it, written in the teammate's voice.
- color and glyph: choose what fits the agent's character. Glyphs: orbit for research and finding things, prism for analysis and precision, wave for writing and tone, spark for ideas and everyday help, grid for planning and structure, bloom for people and support.

If the description is vague, make sensible choices for a small team instead of asking questions. When a current draft is included, apply the requested change and keep everything else that still fits. If the description asks for something harmful, design an agent that helps with the legitimate goal and declines the harmful part.`;

function pickModel(): AiModel {
  const model = pickArchitectModel(configuredModels());
  if (!model) {
    log.error("no AI provider keys configured: set BEDROCK_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, OPENAI_API_KEY or DEEPSEEK_API_KEY");
    throw new AgentRunError("AI isn’t available right now. Try again soon.", "unavailable");
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
  specialty: Specialty | null,
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
${specialty ? `\nThe teammate chose this kind of work: ${SPECIALTY_PROFILES[specialty].label} (${specialty}). Use it unless the request clearly needs another.\n` : ""}${
    current ? `\nThe current draft, to revise according to the request:\n<draft>\n${JSON.stringify(current, null, 2)}\n</draft>\n` : ""
  }
The teammate's request:
<request>
${request}
</request>`;
}

function startFailure(code: string | undefined) {
  if (code === "P0402") return new AgentRunError("You’re out of AI credits.", "out_of_credits");
  if (code === "P0429") return new AgentRunError("You’re drafting agents quickly. Give it a minute.", "invalid");
  return new AgentRunError("Couldn’t start drafting. Try again.", "invalid");
}

export interface BlueprintResult {
  draft: AgentDraft;
  model: string;
  credits: number;
}

/** Turns a plain-language description into an agent draft, billed to the asker's own credits. */
export async function draftAgentBlueprint(input: {
  userId: string;
  workspaceId: string;
  prompt: string;
  current: AgentDraft | null;
  specialty: Specialty | null;
}): Promise<BlueprintResult> {
  let model = pickModel();
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
    const prompt = buildPrompt(input.prompt, input.current, input.specialty, context);

    const reservation = estimateReservation(model, {
      inputTokens: estimateTokens(ARCHITECT_SYSTEM + prompt + JSON.stringify(ARCHITECT_JSON_SCHEMA)),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
    });
    const { data: held, error: holdError } = await admin.rpc("ai_reserve_credits", { p_run_id: runId, p_amount: reservation });
    if (holdError) throw holdError;
    if (!held) throw new AgentRunError("You’re out of AI credits.", "out_of_credits");

    const signal = AbortSignal.timeout(55_000);
    const tried = new Set<string>();
    let result: { value: AgentDraft; usage: StepUsage; model?: AiModel } | null = null;
    while (!result) {
      tried.add(model.id);
      try {
        result = await providerClient(model.provider).generateObject({
          model,
          system: ARCHITECT_SYSTEM,
          prompt,
          jsonSchema: ARCHITECT_JSON_SCHEMA,
          parse: (value) => normalizeDraft(architectOutputSchema.parse(value)),
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          signal,
        });
      } catch (error) {
        // If the account can't use this model, the next one in line drafts instead.
        const next =
          worthAnotherModel(error) && tried.size < MAX_MODEL_ATTEMPTS
            ? architectCandidates(configuredModels()).find((item) => !tried.has(item.id) && !isModelRefused(item.id))
            : undefined;
        if (!next) throw error;
        log.warn("the account can't use this model; another model is drafting", { runId, from: model.id, to: next.id });
        model = next;
        const { error: modelError } = await admin.from("ai_runs").update({ model: model.id }).eq("id", runId);
        if (modelError) log.warn("could not record the stand-in model", { runId, error: modelError });
      }
    }
    usage = result.usage;

    const draft = {
      ...result.value,
      handle: uniqueHandle(result.value.handle, new Set(context.agents.map((agent) => agent.handle))),
    };
    // If the account couldn't use the preferred model, another one drafted it: bill what actually ran.
    const billed = result.model ?? model;
    const credits = creditsForUsage(billed, usage);
    await admin.rpc("ai_settle_credits", {
      p_run_id: runId,
      p_credits: credits,
      p_input_tokens: usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens,
      p_output_tokens: usage.outputTokens,
    });
    await admin.rpc("ai_finish_run", { p_run_id: runId, p_status: "succeeded" });
    return { draft, model: billed.id, credits };
  } catch (error) {
    log.warn("architect failed", { runId, error });
    const credits = usage ? creditsForUsage(model, usage) : 0;
    await admin.rpc("ai_settle_credits", { p_run_id: runId, p_credits: credits });
    await admin.rpc("ai_finish_run", {
      p_run_id: runId,
      p_status: "failed",
      // Drafting runs have no chat message, so the provider's reason goes straight onto the private run record.
      p_error: (error instanceof ProviderError && error.detail
        ? `${error.message} (${error.detail})`
        : error instanceof Error
          ? error.message
          : "Drafting failed."
      ).slice(0, 500),
    });
    if (error instanceof AgentRunError) throw error;
    if (error instanceof SyntaxError || (error instanceof Error && error.name === "ZodError")) {
      throw new AgentRunError("The draft came back incomplete. Try again.", "invalid");
    }
    throw error;
  }
}
