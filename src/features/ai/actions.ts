"use server";

import { fail, ok, toFieldErrors, type ActionResult } from "@/lib/action-result";
import { getErrorMessage } from "@/lib/errors";
import { mapAgent } from "@/lib/mappers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import type { Agent } from "@/types/domain";

import { agentInputSchema, type AgentInput } from "./agent-spec";
import { findModel, PROVIDERS } from "./models";
import { isProviderConfigured } from "./server/env";

type ParsedAgent = ReturnType<typeof agentInputSchema.parse>;

function validate(input: AgentInput): { ok: true; data: ParsedAgent } | { ok: false; result: ActionResult<never> } {
  const parsed = agentInputSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, result: fail("Check the highlighted fields.", toFieldErrors(parsed.error.issues)) };
  }

  const model = findModel(parsed.data.model);
  if (!model) return { ok: false, result: fail("Choose a model.", { model: "Choose one of the listed models." }) };
  if (!isProviderConfigured(model.provider)) {
    return {
      ok: false,
      result: fail(`${PROVIDERS[model.provider].label} isn't connected on this server.`, {
        model: `Add ${PROVIDERS[model.provider].envKey} on the server, or choose another model.`,
      }),
    };
  }

  // Web search only exists on models that host it; quietly drop it elsewhere.
  const tools = model.webSearch ? parsed.data.tools : parsed.data.tools.filter((tool) => tool !== "web");
  return { ok: true, data: { ...parsed.data, tools } };
}

function editableFields(data: ParsedAgent) {
  return {
    name: data.name,
    handle: data.handle,
    tagline: data.tagline,
    instructions: data.instructions,
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
