import "server-only";

import { notFound, redirect } from "next/navigation";

import { mapConversation, mapMember, mapWorkspace } from "@/lib/mappers";
import { routes } from "@/lib/routes";
import { getMyPendingInvitations, getMyWorkspaces, getOwnProfile, getServerSupabase } from "@/server/session";

import type { WorkspaceBootstrap } from "../store/workspace-store";

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
  const [membersResult, conversationsResult] = await Promise.all([
    supabase.rpc("list_workspace_members", { p_workspace_id: workspace.id }),
    supabase.rpc("list_conversations", { p_workspace_id: workspace.id }),
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
  };
}
