"use server";

import { fail, ok, toFieldErrors, type ActionResult } from "@/lib/action-result";
import { getErrorMessage } from "@/lib/errors";
import { mapAgent, mapAgentMembers } from "@/lib/mappers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Json, Tables } from "@/types/database";
import type { Agent, AgentExample } from "@/types/domain";

import { agentExampleSchema, agentInputSchema, MAX_EXAMPLES, type AgentInput } from "./agent-spec";
import { findModel } from "./models";
import { configuredModels } from "./server/env";

type ParsedAgent = ReturnType<typeof agentInputSchema.parse>;
type ServerSupabase = Awaited<ReturnType<typeof createSupabaseServerClient>>;

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
    usage: data.usage,
  };
}

type AgentFields = ReturnType<typeof editableFields>;

/** A database without the tasks-and-tuning update has no tuning columns and knows only the original tools. */
const isMissingColumn = (error: { code?: string } | null) => error?.code === "PGRST204" || error?.code === "42703";
/** A database without the sharing update refuses "people" as a visibility. */
const isRefusedValue = (error: { code?: string } | null) => error?.code === "23514";

function withoutTuning(fields: Partial<AgentFields>) {
  const legacy: Partial<AgentFields> = { ...fields, tools: (fields.tools ?? []).filter((tool) => tool !== "tasks" && tool !== "github") };
  delete legacy.rules;
  delete legacy.examples;
  delete legacy.creativity;
  delete legacy.double_check;
  return legacy;
}

/** Before sharing existed there were only two choices; sharing with some people falls back to private. */
function withoutSharing(fields: Partial<AgentFields>) {
  const legacy: Partial<AgentFields> = { ...fields, visibility: fields.visibility === "workspace" ? "workspace" : "private" };
  delete legacy.usage;
  return legacy;
}

function saveError(error: { code?: string; message: string }, handle: string): ActionResult<never> {
  if (error.code === "23505") return fail("That handle is taken.", { handle: `Another agent already answers to @${handle}.` });
  if (error.code === "42501") return fail(error.message.startsWith("Only") ? error.message : "You can't change this agent.");
  return fail(getErrorMessage(error, "Couldn't save the agent. Try again."));
}

type AgentRowResult = { data: Tables<"ai_agents"> | null; error: { code?: string; message: string } | null };

/** Tries the full row, then without newer columns, for databases that haven't had every update yet. */
async function saveRow(write: (fields: Partial<AgentFields>) => PromiseLike<AgentRowResult>, fields: AgentFields) {
  let result = await write(fields);
  if (isMissingColumn(result.error) || isRefusedValue(result.error)) result = await write(withoutSharing(fields));
  if (isMissingColumn(result.error)) result = await write(withoutTuning(withoutSharing(fields)));
  return result;
}

/** Sets who the agent is shared with, when the person saving may, and returns the agent with its members. */
async function withMembers(supabase: ServerSupabase, row: Tables<"ai_agents">, data: ParsedAgent, userId: string): Promise<ActionResult<Agent>> {
  const agent = mapAgent(row);
  const { data: membership } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", row.workspace_id)
    .eq("user_id", userId)
    .maybeSingle();
  const canShare = row.created_by === userId || (membership?.role !== undefined && membership.role !== "member");

  if (canShare) {
    const members = row.visibility === "private" ? [] : data.members.filter((member) => member.userId !== row.created_by);
    const { data: saved, error } = await supabase.rpc("set_agent_members", {
      p_agent_id: row.id,
      p_members: members.map((member) => ({ user_id: member.userId, role: member.role })) as unknown as Json,
    });
    // PGRST202: the database doesn't have sharing yet; the agent itself still saved.
    if (error && error.code !== "PGRST202") return fail(getErrorMessage(error, "The agent saved, but sharing it didn't. Try again."));
    return ok({ ...agent, members: saved ? mapAgentMembers(saved) : [] });
  }

  const { data: current } = await supabase.from("ai_agent_members").select("user_id, role").eq("agent_id", row.id);
  return ok({ ...agent, members: mapAgentMembers(current ?? []) });
}

export async function createAgent(input: AgentInput): Promise<ActionResult<Agent>> {
  const checked = validate(input);
  if (!checked.ok) return checked.result;

  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return fail("Your session ended. Sign in again.");
  const userId = auth.user.id;

  const result = await saveRow(
    (fields) =>
      supabase
        .from("ai_agents")
        .insert({ workspace_id: checked.data.workspaceId, created_by: userId, ...(fields as AgentFields) })
        .select("*")
        .single(),
    editableFields(checked.data),
  );
  if (result.error || !result.data) return saveError(result.error ?? { message: "Couldn't save the agent." }, checked.data.handle);
  return withMembers(supabase, result.data, checked.data, userId);
}

export async function updateAgent(agentId: string, input: AgentInput): Promise<ActionResult<Agent>> {
  const checked = validate(input);
  if (!checked.ok) return checked.result;

  const supabase = await createSupabaseServerClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return fail("Your session ended. Sign in again.");

  const result = await saveRow(
    (fields) =>
      supabase
        .from("ai_agents")
        .update(fields)
        .eq("id", agentId)
        .eq("workspace_id", checked.data.workspaceId)
        .is("archived_at", null)
        .select("*")
        .maybeSingle(),
    editableFields(checked.data),
  );
  if (result.error) return saveError(result.error, checked.data.handle);
  if (!result.data) return fail("Only the person who made this agent, its editors or an admin can change it.");
  return withMembers(supabase, result.data, checked.data, auth.user.id);
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
  if (!data) return fail("Only the person who made this agent, its editors or an admin can archive it.");
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
  if (!data) return fail("Only the person who made this agent, its editors or an admin can tune it.");
  const { data: members } = await supabase.from("ai_agent_members").select("user_id, role").eq("agent_id", agentId);
  return ok({ ...mapAgent(data), members: mapAgentMembers(members ?? []) });
}
