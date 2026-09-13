import type { ConversationKind, MessageKind, WorkspaceRole } from "./database";

export type { ConversationKind, MessageKind, WorkspaceRole };

export const PERSON_COLORS = [
  "tomato",
  "saffron",
  "grass",
  "lagoon",
  "cobalt",
  "iris",
  "bubblegum",
  "clay",
] as const;

export type PersonColor = (typeof PERSON_COLORS)[number];

export interface Person {
  id: string;
  email: string;
  fullName: string | null;
  displayName: string | null;
  title: string | null;
  statusText: string | null;
  avatarPath: string | null;
  color: PersonColor;
}

export interface Profile extends Person {
  onboardedAt: string | null;
}

export interface Member extends Person {
  role: WorkspaceRole;
  joinedAt: string;
  lastSeenAt: string | null;
}

/** Live presence reported over the workspace channel. */
export type PresenceStatus = "active" | "away";

export interface WorkspaceSummary {
  id: string;
  name: string;
  slug: string;
  role: WorkspaceRole;
  memberCount: number;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  teamSize: string | null;
  useCase: string | null;
  membersCanInvite: boolean;
  createdAt: string;
}

export interface Participant {
  userId: string;
  joinedAt: string;
  lastReadAt: string;
}

export type SystemEvent = "group_created" | "members_added" | "member_left" | "renamed";

export interface SystemMeta {
  event?: SystemEvent;
  name?: string | null;
  user_ids?: string[];
}

export interface MessagePreview {
  id: string;
  senderId: string | null;
  kind: MessageKind;
  body: string;
  meta: SystemMeta;
  attachmentCount: number;
  deletedAt: string | null;
  createdAt: string;
}

export interface Conversation {
  id: string;
  kind: ConversationKind;
  name: string | null;
  createdBy: string | null;
  createdAt: string;
  lastMessageAt: string | null;
  muted: boolean;
  lastReadAt: string;
  unreadCount: number;
  participants: Participant[];
  lastMessage: MessagePreview | null;
}

export interface Attachment {
  path: string;
  name: string;
  size: number;
  type: string;
  width?: number;
  height?: number;
}

export interface Reaction {
  emoji: string;
  userId: string;
}

export interface ReplyPreview {
  id: string;
  senderId: string | null;
  body: string;
  attachmentCount: number;
  deletedAt: string | null;
}

/** "sending" and "failed" only exist on this device, before the server confirms. */
export type DeliveryState = "sent" | "sending" | "failed";

export interface Message {
  id: string;
  conversationId: string;
  senderId: string | null;
  kind: MessageKind;
  body: string;
  attachments: Attachment[];
  meta: SystemMeta;
  replyToId: string | null;
  replyTo: ReplyPreview | null;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  /** Server clock of the last change; the sync cursor. */
  updatedAt: string;
  /** Increments on every server-side change; newer versions win. */
  version: number;
  reactions: Reaction[];
  delivery: DeliveryState;
}

export interface PendingInvitation {
  token: string;
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  role: WorkspaceRole;
  inviterName: string;
  memberCount: number;
  expiresAt: string;
}
