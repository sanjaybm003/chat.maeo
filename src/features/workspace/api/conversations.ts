import { mapConversation } from "@/lib/mappers";

import { db, unwrap } from "./client";

export async function fetchConversations(workspaceId: string) {
  const rows = unwrap(await db().rpc("list_conversations", { p_workspace_id: workspaceId }));
  return (rows ?? []).map(mapConversation);
}

export async function fetchConversation(workspaceId: string, conversationId: string) {
  const rows = unwrap(
    await db().rpc("list_conversations", { p_workspace_id: workspaceId, p_conversation_id: conversationId }),
  );
  return rows?.[0] ? mapConversation(rows[0]) : null;
}

export async function openDirectConversation(workspaceId: string, userId: string) {
  return unwrap(await db().rpc("create_direct_conversation", { p_workspace_id: workspaceId, p_user_id: userId }));
}

export async function createGroupConversation(workspaceId: string, memberIds: string[], name: string | null) {
  return unwrap(
    await db().rpc("create_group_conversation", {
      p_workspace_id: workspaceId,
      p_member_ids: memberIds,
      p_name: name,
    }),
  );
}

/** Returns the conversation to show next: the same group, or a new one when adding to a 1:1. */
export async function addParticipants(conversationId: string, userIds: string[]) {
  return unwrap(await db().rpc("add_conversation_participants", { p_conversation_id: conversationId, p_user_ids: userIds }));
}

export async function leaveConversation(conversationId: string) {
  unwrap(await db().rpc("leave_conversation", { p_conversation_id: conversationId }));
}

export async function renameConversation(conversationId: string, name: string | null) {
  unwrap(await db().rpc("rename_conversation", { p_conversation_id: conversationId, p_name: name }));
}

export async function markConversationRead(conversationId: string, readAt?: string) {
  return unwrap(await db().rpc("mark_conversation_read", { p_conversation_id: conversationId, p_read_at: readAt ?? null }));
}

export async function setConversationMuted(conversationId: string, muted: boolean) {
  unwrap(await db().rpc("set_conversation_muted", { p_conversation_id: conversationId, p_muted: muted }));
}
