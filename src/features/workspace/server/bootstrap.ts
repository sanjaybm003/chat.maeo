import "server-only";

import { notFound, redirect } from "next/navigation";

import { configuredModels } from "@/features/ai/server/env";
import { logger } from "@/lib/logger";
import { mapAgent, mapConversation, mapCreditAccount, mapMember, mapWorkspace } from "@/lib/mappers";
import { routes } from "@/lib/routes";
import { getMyPendingInvitations, getMyWorkspaces, getOwnProfile, getServerSupabase } from "@/server/session";

import type { AiBootstrap, WorkspaceBootstrap } from "../store/workspace-store";

type ServerSupabase = Awaited<ReturnType<typeof getServerSupabase>>;

/** Chat keeps working on a database that hasn't had the AI migration yet; agents just stay hidden. */
async function loadAi(supabase: ServerSupabase, workspaceId: string): Promise<AiBootstrap> {
  const models = configuredModels().map((model) => model.id);
  const [agents, credits] = await Promise.all([
    supabase.from("ai_agents").select("*").eq("workspace_id", workspaceId).order("created_at"),
    supabase
      .from("ai_credit_accounts")
      .select("balance, reserved, lifetime_granted, lifetime_used")
      .eq("workspace_id", workspaceId)
      .maybeSingle(),
  ]);

  const error = agents.error ?? credits.error;
  if (error) {
    logger.warn("AI data unavailable; apply supabase/migrations/20260915000100_ai_agents.sql", { error });
    return { ready: false, models, agents: [], credits: null };
  }
  return { ready: true, models, agents: (agents.data ?? []).map(mapAgent), credits: mapCreditAccount(credits.data) };
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
  const [membersResult, conversationsResult, ai] = await Promise.all([
    supabase.rpc("list_workspace_members", { p_workspace_id: workspace.id }),
    supabase.rpc("list_conversations", { p_workspace_id: workspace.id }),
    loadAi(supabase, workspace.id),
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
  };
}
