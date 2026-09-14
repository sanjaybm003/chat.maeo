"use server";

import { fail, ok, toFieldErrors, type ActionResult } from "@/lib/action-result";
import { getErrorMessage } from "@/lib/errors";
import { mapAgent } from "@/lib/mappers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Agent } from "@/types/domain";

import { agentInputSchema, type AgentInput } from "./agent-spec";
import { findModel } from "./models";
import { configuredModels } from "./server/env";

type ParsedAgent = ReturnType<typeof agentInputSchema.parse>;

function validate(input: AgentInput): { ok: true; data: ParsedAgent } | { ok: false; result: ActionResult<never> } {
  const parsed = agentInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, result: fail("Check the highlighted fields.", toFieldErrors(parsed.error.issues)) };
  }

  const available = configuredModels();
  let model = findModel(parsed.data.model);

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

  // In fixed mode web search only works on models that host it; auto routing picks one when needed.
  const tools =
    parsed.data.modelMode === "fixed" && !model?.webSearch ? parsed.data.tools.filter((tool) => tool !== "web") : parsed.data.tools;
  return { ok: true, data: { ...parsed.data, model: model?.id ?? parsed.data.model, tools } };
}

function editableFields(data: ParsedAgent) {
  return {
    name: data.name,
    handle: data.handle,
    tagline: data.tagline,
    instructions: data.instructions,
    knowledge: data.knowledge,
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

  const { data, error } = await supabase
    .from("ai_agents")
    .insert({ workspace_id: checked.data.workspaceId, created_by: auth.user.id, ...editableFields(checked.data) })
    .select("*")
    .single();
  if (error) return saveError(error, checked.data.handle);
  return ok(mapAgent(data));
}

export async function updateAgent(agentId: string, input: AgentInput): Promise<ActionResult<Agent>> {
  const checked = validate(input);
  if (!checked.ok) return checked.result;

  const supabase = await createSupabaseServerClient();
  const { data, error } = await supabase
    .from("ai_agents")
    .update(editableFields(checked.data))
    .eq("id", agentId)
    .eq("workspace_id", checked.data.workspaceId)
    .is("archived_at", null)
    .select("*")
    .maybeSingle();
  if (error) return saveError(error, checked.data.handle);
  if (!data) return fail("Only the person who made this agent, or an admin, can edit it.");
  return ok(mapAgent(data));
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
