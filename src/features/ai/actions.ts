"use server";

import { fail, ok, toFieldErrors, type ActionResult } from "@/lib/action-result";
import { getErrorMessage } from "@/lib/errors";
import { mapAgent } from "@/lib/mappers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";
import type { Agent, AgentExample } from "@/types/domain";

import { agentExampleSchema, agentInputSchema, MAX_EXAMPLES, type AgentInput } from "./agent-spec";
import { findModel } from "./models";
import { configuredModels } from "./server/env";

type ParsedAgent = ReturnType<typeof agentInputSchema.parse>;

function validate(input: AgentInput): { ok: true; data: ParsedAgent } | { ok: false; result: ActionResult<never> } {
  const parsed = agentInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, result: fail("Check the highlighted fields.", toFieldErrors(parsed.error.issues)) };
  }

  const available = configuredModels();
  // The served copy knows host limits, such as no built-in web search for Claude on Bedrock.
  let model = available.find((item) => item.id === parsed.data.model) ?? findModel(parsed.data.model);

  if (parsed.data.modelMode === "fixed") {
    if (!model || !available.some((item) => item.id === model!.id)) {
      return {
        ok: false,
        result: fail("That model isn’t available right now.", { model: "Choose another model, or let Auto pick one." }),
      };
    }
  } else if (!model) {
    // Auto still keeps a sensible fallback model on the row.
    model = available[0] ?? findModel("claude-sonnet-5");
  }

  // Every model can use the web now: through its own search, or through maeosan's search and page reader.
  return { ok: true, data: { ...parsed.data, model: model?.id ?? parsed.data.model } };
}

function editableFields(data: ParsedAgent) {
  return {
    name: data.name,
    handle: data.handle,
    tagline: data.tagline,
    instructions: data.instructions,
    knowledge: data.knowledge,
    rules: data.rules,
    examples: data.examples as unknown as Json,
    creativity: data.creativity,
    double_check: data.doubleCheck,
    specialty: data.specialty,
    response_style: data.responseStyle,
    model_mode: data.modelMode,
    model: data.model,
    tools: data.tools,
    starters: data.starters,
    color: data.color,
    glyph: data.glyph,
    visibility: data.visibility,
  };
}

type AgentFields = ReturnType<typeof editableFields>;

/** A database without the tasks-and-tuning update has no tuning columns and knows only the original tools. */
const isMissingColumn = (error: { code?: string } | null) => error?.code === "PGRST204" || error?.code === "42703";

function withoutTuning(fields: AgentFields) {
  const legacy: Partial<AgentFields> = { ...fields, tools: fields.tools.filter((tool) => tool !== "tasks" && tool !== "github") };
  delete legacy.rules;
  delete legacy.examples;
  delete legacy.creativity;
  delete legacy.double_check;
  return legacy;
}

function saveError(error: { code?: string; message: string }, handle: string): ActionResult<never> {
  if (error.code === "23505") return fail("That handle is taken.", { handle: `Another agent already answers to @${handle}.` });
  if (error.code === "42501") return fail("You can't change agents in this workspace.");
  return fail(getErrorMessage(error, "Couldn't save the agent. Try again."));
}

export async function createAgent(input: AgentInput): Promise<ActionResult<Agent>> {
  const checked = validate(input);
  if (!checked.ok) return checked.result;

  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return fail("Your session ended. Sign in again.");

  const insert = (fields: Partial<AgentFields>) =>
    supabase
      .from("ai_agents")
      .insert({ workspace_id: checked.data.workspaceId, created_by: auth.user!.id, ...(fields as AgentFields) })
      .select("*")
      .single();
  let result = await insert(editableFields(checked.data));
  if (isMissingColumn(result.error)) result = await insert(withoutTuning(editableFields(checked.data)));
  if (result.error) return saveError(result.error, checked.data.handle);
  return ok(mapAgent(result.data));
}

export async function updateAgent(agentId: string, input: AgentInput): Promise<ActionResult<Agent>> {
  const checked = validate(input);
  if (!checked.ok) return checked.result;

  const supabase = await createSupabaseServerClient();
  const update = (fields: Partial<AgentFields>) =>
    supabase
      .from("ai_agents")
      .update(fields)
      .eq("id", agentId)
      .eq("workspace_id", checked.data.workspaceId)
      .is("archived_at", null)
      .select("*")
      .maybeSingle();
  let result = await update(editableFields(checked.data));
  if (isMissingColumn(result.error)) result = await update(withoutTuning(editableFields(checked.data)));
  if (result.error) return saveError(result.error, checked.data.handle);
  if (!result.data) return fail("Only the person who made this agent, or an admin, can edit it.");
  return ok(mapAgent(result.data));
}

export async function archiveAgent(agentId: string): Promise<ActionResult<Agent>> {
  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("ai_agents")
    .update({ archived_at: new Date().toISOString() })
    .eq("id", agentId)
    .is("archived_at", null)
    .select("*")
    .maybeSingle();
  if (error) return fail(getErrorMessage(error, "Couldn't archive the agent."));
  if (!data) return fail("Only the person who made this agent, or an admin, can archive it.");
  return ok(mapAgent(data));
}

/**
 * Keeps a reply the team liked as a worked example, so the agent answers
 * similar messages the same way. The newest examples are kept.
 */
export async function addAgentExample(agentId: string, example: AgentExample): Promise<ActionResult<Agent>> {
  const parsed = agentExampleSchema.safeParse(example);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "That example can't be saved.");

  const supabase = await createSupabaseServerClient();
  const { data: row, error: readError } = await supabase.from("ai_agents").select("*").eq("id", agentId).is("archived_at", null).maybeSingle();
  if (readError) return fail(getErrorMessage(readError, "Couldn't save the example."));
  if (!row) return fail("That agent isn’t available.");

  const examples = [...mapAgent(row).examples.filter((item) => item.prompt !== parsed.data.prompt), parsed.data].slice(-MAX_EXAMPLES);
  const { data, error } = await supabase
    .from("ai_agents")
    .update({ examples: examples as unknown as Json })
    .eq("id", agentId)
    .select("*")
    .maybeSingle();
  if (error) return fail(getErrorMessage(error, "Couldn't save the example."));
  if (!data) return fail("Only the person who made this agent, or an admin, can tune it.");
  return ok(mapAgent(data));
}
