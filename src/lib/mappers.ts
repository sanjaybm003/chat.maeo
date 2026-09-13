import { toPersonColor } from "@/lib/colors";
import type { Json, RpcReturn, Tables } from "@/types/database";
import type {
  Attachment,
  Conversation,
  Member,
  Message,
  MessageKind,
  MessagePreview,
  PendingInvitation,
  Profile,
  Reaction,
  ReplyPreview,
  SystemMeta,
  Workspace,
  WorkspaceSummary,
} from "@/types/domain";

/**
 * The only place database rows become domain objects. Everything arriving from
 * the network (RPC rows, realtime payloads) is untrusted and parsed defensively.
 */

type JsonObject = { [key: string]: Json | undefined };

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function mapProfile(row: Tables<"profiles">): Profile {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    displayName: row.display_name,
    title: row.title,
    statusText: row.status_text,
    avatarPath: row.avatar_path,
    color: toPersonColor(row.color),
    onboardedAt: row.onboarded_at,
  };
}

export function mapWorkspace(row: Tables<"workspaces">): Workspace {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    teamSize: row.team_size,
    useCase: row.use_case,
    membersCanInvite: row.members_can_invite,
    createdAt: row.created_at,
  };
}

export function mapMember(row: RpcReturn<"list_workspace_members">[number]): Member {
  return {
    id: row.user_id,
    email: row.email,
    fullName: row.full_name,
    displayName: row.display_name,
    title: row.title,
    statusText: row.status_text,
    avatarPath: row.avatar_path,
    color: toPersonColor(row.color),
    role: row.role,
    joinedAt: row.joined_at,
    lastSeenAt: row.last_seen_at ?? null,
  };
}

export function mapWorkspaceSummary(row: RpcReturn<"my_workspaces">[number]): WorkspaceSummary {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    role: row.role,
    memberCount: row.member_count,
  };
}

export function mapPendingInvitation(row: RpcReturn<"my_pending_invitations">[number]): PendingInvitation {
  return {
    token: row.token,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name,
    workspaceSlug: row.workspace_slug,
    role: row.role,
    inviterName: row.inviter_name,
    memberCount: row.member_count,
    expiresAt: row.expires_at,
  };
}

function mapMeta(value: unknown): SystemMeta {
  if (!isObject(value)) return {};
  const userIds = Array.isArray(value.user_ids) ? value.user_ids.filter((id): id is string => typeof id === "string") : undefined;
  return {
    event: str(value.event) as SystemMeta["event"],
    name: str(value.name),
    user_ids: userIds,
  };
}

function mapAttachments(value: unknown): Attachment[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isObject(item) || !str(item.path) || !str(item.name)) return [];
    const attachment: Attachment = {
      path: item.path as string,
      name: item.name as string,
      size: num(item.size),
      type: str(item.type) ?? "application/octet-stream",
    };
    if (typeof item.width === "number" && typeof item.height === "number") {
      attachment.width = item.width;
      attachment.height = item.height;
    }
    return [attachment];
  });
}

function mapReactions(value: unknown): Reaction[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) =>
    isObject(item) && str(item.emoji) && str(item.user_id)
      ? [{ emoji: item.emoji as string, userId: item.user_id as string }]
      : [],
  );
}

function mapReplyPreview(value: unknown): ReplyPreview | null {
  if (!isObject(value) || !str(value.id)) return null;
  return {
    id: value.id as string,
    senderId: str(value.sender_id),
    body: str(value.body) ?? "",
    attachmentCount: num(value.attachment_count),
    deletedAt: str(value.deleted_at),
  };
}

function mapPreview(value: unknown): MessagePreview | null {
  if (!isObject(value) || !str(value.id)) return null;
  return {
    id: value.id as string,
    senderId: str(value.sender_id),
    kind: (str(value.kind) ?? "text") as MessageKind,
    body: str(value.body) ?? "",
    meta: mapMeta(value.meta),
    attachmentCount: num(value.attachment_count),
    deletedAt: str(value.deleted_at),
    createdAt: str(value.created_at) ?? new Date(0).toISOString(),
  };
}

export function mapConversation(row: RpcReturn<"list_conversations">[number]): Conversation {
  const participants = Array.isArray(row.participants) ? row.participants : [];
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    createdBy: row.created_by,
    createdAt: row.created_at,
    lastMessageAt: row.last_message_at,
    muted: row.muted,
    lastReadAt: row.last_read_at,
    unreadCount: row.unread_count,
    participants: participants.flatMap((item) =>
      isObject(item) && str(item.user_id)
        ? [
            {
              userId: item.user_id as string,
              joinedAt: str(item.joined_at) ?? row.created_at,
              lastReadAt: str(item.last_read_at) ?? row.created_at,
            },
          ]
        : [],
    ),
    lastMessage: mapPreview(row.last_message),
  };
}

/** Accepts a get_messages / get_message_changes row or a realtime payload. */
export function mapMessage(value: unknown): Message | null {
  if (!isObject(value) || !str(value.id) || !str(value.conversation_id)) return null;
  const createdAt = str(value.created_at) ?? new Date().toISOString();
  return {
    id: value.id as string,
    conversationId: value.conversation_id as string,
    senderId: str(value.sender_id),
    kind: (str(value.kind) ?? "text") as MessageKind,
    body: str(value.body) ?? "",
    attachments: mapAttachments(value.attachments),
    meta: mapMeta(value.meta),
    replyToId: str(value.reply_to_id),
    replyTo: mapReplyPreview(value.reply_to),
    editedAt: str(value.edited_at),
    deletedAt: str(value.deleted_at),
    createdAt,
    updatedAt: str(value.updated_at) ?? createdAt,
    version: typeof value.version === "number" ? value.version : 1,
    reactions: mapReactions(value.reactions),
    delivery: "sent",
  };
}

export function previewOf(message: Message): MessagePreview {
  return {
    id: message.id,
    senderId: message.senderId,
    kind: message.kind,
    body: message.body.slice(0, 180),
    meta: message.meta,
    attachmentCount: message.attachments.length,
    deletedAt: message.deletedAt,
    createdAt: message.createdAt,
  };
}
