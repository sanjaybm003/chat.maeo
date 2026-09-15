import "server-only";

import { notFound, redirect } from "next/navigation";

import { refreshBedrockCatalog } from "@/features/ai/server/bedrock-catalog";
import { configuredModels } from "@/features/ai/server/env";
import { webSearchAvailable } from "@/features/ai/server/web";
import { githubApp } from "@/features/integrations/server/github";
import { TASK_WINDOW_DAYS } from "@/features/tasks/api";
import { logger } from "@/lib/logger";
import { mapAgent, mapAgentMembers, mapConversation, mapCreditAccount, mapIntegration, mapMember, mapTask, mapWorkspace } from "@/lib/mappers";
import { routes } from "@/lib/routes";
import { getMyPendingInvitations, getMyWorkspaces, getOwnProfile, getServerSupabase } from "@/server/session";

import type { AiBootstrap, IntegrationsBootstrap, TasksBootstrap, WorkspaceBootstrap } from "../store/workspace-store";

type ServerSupabase = Awaited<ReturnType<typeof getServerSupabase>>;

/** How long the first page load waits for Bedrock's model list before showing every model. */
const CATALOG_WAIT_MS = 600;

/** Tasks stay hidden until the tasks migration is applied; everything else keeps working. */
async function loadTasks(supabase: ServerSupabase, workspaceId: string): Promise<TasksBootstrap> {
  const since = new Date(Date.now() - TASK_WINDOW_DAYS * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("tasks")
    .select("*")
    .eq("workspace_id", workspaceId)
    .or(`status.in.(todo,in_progress,blocked),updated_at.gte.${since}`)
    .order("updated_at", { ascending: false })
    .limit(1000);
  if (error) {
    logger.warn("Tasks unavailable; apply supabase/migrations/20260917000100_tasks_tuning_integrations.sql", { error });
    return { ready: false, items: [] };
  }
  return { ready: true, items: (data ?? []).flatMap((row) => mapTask(row) ?? []) };
}

async function loadIntegrations(supabase: ServerSupabase, workspaceId: string): Promise<IntegrationsBootstrap> {
  const { data, error } = await supabase.from("workspace_integrations").select("*").eq("workspace_id", workspaceId);
  return {
    githubAvailable: githubApp.configured,
    items: error ? [] : (data ?? []).flatMap((row) => mapIntegration(row) ?? []),
  };
}

/** Chat keeps working on a database that hasn't had the AI migrations yet; agents just stay hidden. */
async function loadAi(supabase: ServerSupabase, workspaceId: string, userId: string): Promise<AiBootstrap> {
  const [agents, credits, shares] = await Promise.all([
    supabase.from("ai_agents").select("*").eq("workspace_id", workspaceId).order("created_at"),
    supabase
      .from("ai_wallets")
      .select("balance, reserved, lifetime_granted, lifetime_used")
      .eq("user_id", userId)
      .maybeSingle(),
    // Row level security returns sharing only for agents this person can see. Missing before the sharing update.
    supabase.from("ai_agent_members").select("agent_id, user_id, role"),
    refreshBedrockCatalog(CATALOG_WAIT_MS),
  ]);
  const membersByAgent = new Map<string, Array<{ user_id: string; role: string }>>();
  for (const row of shares.error ? [] : (shares.data ?? [])) {
    membersByAgent.set(row.agent_id, [...(membersByAgent.get(row.agent_id) ?? []), row]);
  }
  const available = configuredModels();
  const models = available.map((model) => model.id);
  const webSearch = webSearchAvailable() || available.some((model) => model.webSearch !== null);

  const error = agents.error ?? credits.error;
  if (error) {
    logger.warn("AI data unavailable; apply the migrations in supabase/migrations up to 20260916000100", { error });
    return { ready: false, models, webSearch, agents: [], credits: null };
  }
  return {
    ready: true,
    models,
    webSearch,
    agents: (agents.data ?? []).map((row) => ({ ...mapAgent(row), members: mapAgentMembers(membersByAgent.get(row.id) ?? []) })),
    credits: mapCreditAccount(credits.data),
  };
}

/**
 * Everything the workspace needs for its first paint, fetched in parallel on
 * the server so the sidebar never flashes empty.
 */
export async function loadWorkspaceBootstrap(userId: string, slug: string): Promise<WorkspaceBootstrap> {
  const supabase = await getServerSupabase();

  const [profile, workspaceResult, workspaces, pendingInvitations] = await Promise.all([
    getOwnProfile(userId),
    supabase.from("workspaces").select("*").eq("slug", slug).maybeSingle(),
    getMyWorkspaces(),
    getMyPendingInvitations(),
  ]);

  if (!profile?.fullName) {
    redirect(`${routes.onboarding.profile}?next=${encodeURIComponent(routes.workspace(slug))}`);
  }
  if (workspaceResult.error) throw workspaceResult.error;
  if (!workspaceResult.data) notFound();

  const workspace = mapWorkspace(workspaceResult.data);
  const [membersResult, conversationsResult, ai, tasks, integrations] = await Promise.all([
    supabase.rpc("list_workspace_members", { p_workspace_id: workspace.id }),
    supabase.rpc("list_conversations", { p_workspace_id: workspace.id }),
    loadAi(supabase, workspace.id, userId),
    loadTasks(supabase, workspace.id),
    loadIntegrations(supabase, workspace.id),
  ]);
  if (membersResult.error) throw membersResult.error;
  if (conversationsResult.error) throw conversationsResult.error;

  return {
    me: profile,
    workspace,
    myRole: workspaces.find((item) => item.id === workspace.id)?.role ?? "member",
    workspaces,
    members: (membersResult.data ?? []).map(mapMember),
    conversations: (conversationsResult.data ?? []).map(mapConversation),
    pendingInvitations,
    ai,
    tasks,
    integrations,
  };
}
