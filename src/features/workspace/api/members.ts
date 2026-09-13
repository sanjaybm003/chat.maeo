import { mapMember, mapProfile, mapWorkspace } from "@/lib/mappers";

import { db, unwrap } from "./client";

export async function fetchMembers(workspaceId: string) {
  const rows = unwrap(await db().rpc("list_workspace_members", { p_workspace_id: workspaceId }));
  return (rows ?? []).map(mapMember);
}

export async function fetchMember(workspaceId: string, userId: string) {
  const rows = unwrap(await db().rpc("list_workspace_members", { p_workspace_id: workspaceId, p_user_id: userId }));
  return rows?.[0] ? mapMember(rows[0]) : null;
}

export async function fetchWorkspace(workspaceId: string) {
  const row = unwrap(await db().from("workspaces").select("*").eq("id", workspaceId).maybeSingle());
  return row ? mapWorkspace(row) : null;
}

/** Presence heartbeat. The server writes at most every 45 seconds; failures are harmless. */
export async function touchPresence() {
  try {
    await db().rpc("touch_presence");
  } catch {
    // The next heartbeat tries again.
  }
}

export async function fetchOwnProfile(userId: string) {
  const row = unwrap(await db().from("profiles").select("*").eq("id", userId).single());
  return mapProfile(row);
}

export async function updateMemberRole(workspaceId: string, userId: string, role: "admin" | "member") {
  unwrap(await db().rpc("update_member_role", { p_workspace_id: workspaceId, p_user_id: userId, p_role: role }));
}

export async function removeMember(workspaceId: string, userId: string) {
  unwrap(await db().rpc("remove_workspace_member", { p_workspace_id: workspaceId, p_user_id: userId }));
}

export async function transferOwnership(workspaceId: string, userId: string) {
  unwrap(await db().rpc("transfer_workspace_ownership", { p_workspace_id: workspaceId, p_user_id: userId }));
}

export async function fetchPendingInvitations(workspaceId: string) {
  const rows = unwrap(
    await db()
      .from("invitations")
      .select("id, email, role, token, invited_by, created_at, expires_at")
      .eq("workspace_id", workspaceId)
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
  );
  return (rows ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role,
    token: row.token,
    invitedBy: row.invited_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
  }));
}

export type WorkspaceInvitation = Awaited<ReturnType<typeof fetchPendingInvitations>>[number];
