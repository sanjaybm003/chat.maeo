import { toPersonColor } from "@/lib/colors";
import type { Json, RpcReturn, Tables } from "@/types/database";
import {
  AGENT_GLYPHS,
  AGENT_TOOL_IDS,
  CREATIVITY_LEVELS,
  MODEL_MODES,
  RESPONSE_STYLES,
  SPECIALTIES,
  TASK_PRIORITIES,
  TASK_STATUSES,
  type Agent,
  type AgentExample,
  type AgentRoute,
  type AgentRun,
  type AgentRunStatus,
  type AgentRunStep,
  type AgentToolId,
  type Attachment,
  type Conversation,
  type CreditAccount,
  type Integration,
  type Member,
  type Message,
  type MessageKind,
  type MessagePreview,
  type PendingInvitation,
  type Profile,
  type Reaction,
  type ReplyPreview,
  type SystemMeta,
  type Task,
  type UsageSummary,
  type Workspace,
  type WorkspaceSummary,
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
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;

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
  const meta: SystemMeta = {
    event: str(value.event) as SystemMeta["event"],
    name: str(value.name),
    user_ids: userIds,
  };
  const agentId = str(value.agent_id);
  if (agentId) meta.agent_id = agentId;
  const taskId = str(value.task_id);
  if (taskId) meta.task_id = taskId;
  if (typeof value.number === "number" && Number.isInteger(value.number)) meta.number = value.number;
  if (value.source === "webhook") meta.source = "webhook";
  const webhookId = str(value.webhook_id);
  if (webhookId) meta.webhook_id = webhookId;
  return meta;
}

const RUN_STATUSES: ReadonlySet<string> = new Set<AgentRunStatus>(["thinking", "working", "done", "failed", "cancelled"]);
const STEP_KINDS: ReadonlySet<string> = new Set<AgentRunStep["kind"]>(["read", "tool", "web", "note"]);
const MAX_STEPS = 20;

export function mapAgentSteps(value: unknown): AgentRunStep[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item) => {
      if (!isObject(item) || !str(item.label)) return [];
      const kind = str(item.kind);
      return [
        {
          kind: kind && STEP_KINDS.has(kind) ? (kind as AgentRunStep["kind"]) : "note",
          label: (item.label as string).slice(0, 140),
        },
      ];
    })
    .slice(-MAX_STEPS);
}

function mapRoute(value: unknown): AgentRoute | null {
  if (!isObject(value)) return null;
  const mode = oneOf(value.mode, ["auto", "fixed", "override"] as const, "auto");
  const reason = str(value.reason);
  if (!reason && !str(value.mode)) return null;
  return { mode, tier: str(value.tier), reason: reason ? reason.slice(0, 200) : null };
}

/** An agent reply's meta, or null for everything else. */
export function mapAgentRun(meta: unknown): AgentRun | null {
  if (!isObject(meta) || !str(meta.run)) return null;
  const status = str(meta.status);
  return {
    runId: meta.run as string,
    status: status && RUN_STATUSES.has(status) ? (status as AgentRunStatus) : "thinking",
    model: str(meta.model),
    requestedBy: str(meta.by),
    route: mapRoute(meta.route),
    steps: mapAgentSteps(meta.steps),
    credits: meta.credits === undefined || meta.credits === null ? null : num(meta.credits),
    error: str(meta.error),
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
    agentId: str(value.agent_id),
    body: str(value.body) ?? "",
    attachmentCount: num(value.attachment_count),
    deletedAt: str(value.deleted_at),
  };
}

function mapPreview(value: unknown): MessagePreview | null {
  if (!isObject(value) || !str(value.id)) return null;
  const agentId = str(value.agent_id);
  return {
    id: value.id as string,
    senderId: str(value.sender_id),
    agentId,
    agentStatus: agentId ? (mapAgentRun(value.meta)?.status ?? null) : null,
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
    agentId: row.agent_id ?? null,
    agentIds: Array.isArray(row.agent_ids) ? row.agent_ids.filter((id): id is string => typeof id === "string") : [],
  };
}

/** Accepts a get_messages / get_message_changes row or a realtime payload. */
export function mapMessage(value: unknown): Message | null {
  if (!isObject(value) || !str(value.id) || !str(value.conversation_id)) return null;
  const createdAt = str(value.created_at) ?? new Date().toISOString();
  const agentId = str(value.agent_id);
  return {
    id: value.id as string,
    conversationId: value.conversation_id as string,
    senderId: str(value.sender_id),
    agentId,
    kind: (str(value.kind) ?? "text") as MessageKind,
    body: str(value.body) ?? "",
    attachments: mapAttachments(value.attachments),
    meta: mapMeta(value.meta),
    run: agentId ? mapAgentRun(value.meta) : null,
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
    agentId: message.agentId,
    agentStatus: message.run?.status ?? null,
    kind: message.kind,
    body: message.body.slice(0, 180),
    meta: message.meta,
    attachmentCount: message.attachments.length,
    deletedAt: message.deletedAt,
    createdAt: message.createdAt,
  };
}

// AI ───────────────────────────────────────────────────────────────────────────

const isToolId = (value: string): value is AgentToolId => (AGENT_TOOL_IDS as readonly string[]).includes(value);

const MAX_EXAMPLES = 6;

export function mapAgentExamples(value: unknown): AgentExample[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((item) => (isObject(item) && str(item.prompt) && str(item.reply) ? [{ prompt: item.prompt as string, reply: item.reply as string }] : []))
    .slice(0, MAX_EXAMPLES);
}

export function mapAgent(row: Tables<"ai_agents">): Agent {
  return {
    id: row.id,
    workspaceId: row.workspace_id,
    createdBy: row.created_by,
    name: row.name,
    handle: row.handle,
    tagline: row.tagline ?? "",
    instructions: row.instructions,
    knowledge: row.knowledge ?? "",
    // Rows from before tuning have none of these columns yet.
    rules: row.rules ?? "",
    examples: mapAgentExamples(row.examples),
    creativity: oneOf(row.creativity, CREATIVITY_LEVELS, "balanced"),
    doubleCheck: row.double_check === true,
    specialty: oneOf(row.specialty, SPECIALTIES, "assistant"),
    responseStyle: oneOf(row.response_style, RESPONSE_STYLES, "balanced"),
    // Rows from before automatic routing have no mode and keep their chosen model.
    modelMode: oneOf(row.model_mode, MODEL_MODES, "fixed"),
    model: row.model,
    tools: (row.tools ?? []).filter(isToolId),
    starters: row.starters ?? [],
    color: toPersonColor(row.color),
    glyph: oneOf(row.glyph, AGENT_GLYPHS, "orbit"),
    visibility: row.visibility === "private" || row.visibility === "people" ? row.visibility : "workspace",
    // Rows from before sharing let everyone who sees an agent use it.
    usage: row.usage === "owner" || row.usage === "people" ? row.usage : "viewers",
    members: [],
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Who an agent is shared with, from its ai_agent_members rows. */
export function mapAgentMembers(rows: ReadonlyArray<{ user_id: string; role: string }>): Agent["members"] {
  return rows.map((row) => ({ userId: row.user_id, role: row.role === "viewer" || row.role === "editor" ? row.role : "user" }));
}

/** A tasks row or the JSON a task function returns. */
export function mapTask(value: unknown): Task | null {
  if (!isObject(value) || !str(value.id) || !str(value.workspace_id) || !str(value.title)) return null;
  const createdAt = str(value.created_at) ?? new Date().toISOString();
  return {
    id: value.id as string,
    workspaceId: value.workspace_id as string,
    number: num(value.number),
    title: value.title as string,
    description: str(value.description) ?? "",
    status: oneOf(value.status, TASK_STATUSES, "todo"),
    priority: oneOf(value.priority, TASK_PRIORITIES, "none"),
    assigneeId: str(value.assignee_id),
    agentId: str(value.agent_id),
    dueOn: str(value.due_on)?.slice(0, 10) ?? null,
    conversationId: str(value.conversation_id),
    messageId: str(value.message_id),
    createdBy: str(value.created_by),
    createdByAgent: str(value.created_by_agent),
    completedAt: str(value.completed_at),
    createdAt,
    updatedAt: str(value.updated_at) ?? createdAt,
    version: typeof value.version === "number" ? value.version : 1,
  };
}

export function mapIntegration(value: unknown): Integration | null {
  if (!isObject(value) || !str(value.id) || value.provider !== "github") return null;
  const settings = isObject(value.settings) ? value.settings : {};
  return {
    id: value.id as string,
    workspaceId: str(value.workspace_id) ?? "",
    provider: "github",
    accountLogin: str(value.account_login) ?? "",
    accountType: str(value.account_type) ?? "",
    defaultRepo: str(settings.default_repo),
    connectedBy: str(value.connected_by),
    createdAt: str(value.created_at) ?? new Date(0).toISOString(),
  };
}

export function mapCreditAccount(value: unknown): CreditAccount | null {
  if (!isObject(value)) return null;
  return {
    balance: num(value.balance),
    reserved: num(value.reserved),
    lifetimeGranted: num(value.lifetime_granted),
    lifetimeUsed: num(value.lifetime_used),
  };
}

function buckets<T>(value: unknown, extra: (item: JsonObject) => T | null) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!isObject(item)) return [];
    const fields = extra(item);
    return fields === null ? [] : [{ ...fields, credits: num(item.credits), runs: num(item.runs) }];
  });
}

export function mapUsageSummary(value: unknown): UsageSummary {
  const data = isObject(value) ? value : {};
  return {
    timeZone: str(data.time_zone) ?? "UTC",
    since: str(data.since) ?? new Date().toISOString(),
    account: mapCreditAccount(data.account),
    days: buckets(data.days, (item) => (str(item.day) ? { day: item.day as string } : null)),
    agents: buckets(data.agents, (item) => ({ agentId: str(item.agent_id), name: str(item.name) })),
    models: buckets(data.models, (item) => (str(item.model) ? { model: item.model as string } : null)),
    workspaces: buckets(data.workspaces, (item) =>
      str(item.workspace_id) ? { workspaceId: item.workspace_id as string, name: str(item.name) ?? "Workspace" } : null,
    ),
  };
}
