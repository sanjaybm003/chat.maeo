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

export type SystemEvent =
  | "group_created"
  | "members_added"
  | "member_left"
  | "renamed"
  | "agent_added"
  | "agent_removed"
  | "task_created"
  | "task_completed";

export interface SystemMeta {
  event?: SystemEvent;
  name?: string | null;
  user_ids?: string[];
  agent_id?: string;
  task_id?: string;
  number?: number;
}

export interface MessagePreview {
  id: string;
  senderId: string | null;
  agentId: string | null;
  /** For agent replies: how the run is going, so an empty reply previews honestly. */
  agentStatus: AgentRunStatus | null;
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
  /** Set for a private room between one person and one agent. */
  agentId: string | null;
  /** Agents that joined this chat alongside the people in it, oldest first. */
  agentIds: string[];
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
  agentId: string | null;
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
  /** Set when an AI agent wrote the message. */
  agentId: string | null;
  kind: MessageKind;
  body: string;
  attachments: Attachment[];
  meta: SystemMeta;
  /** Present on agent replies: how the run that wrote it is going. */
  run: AgentRun | null;
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

// AI agents ───────────────────────────────────────────────────────────────────

export const AGENT_TOOL_IDS = ["history", "search", "directory", "web", "tasks", "github"] as const;
export type AgentToolId = (typeof AGENT_TOOL_IDS)[number];

export const AGENT_GLYPHS = ["orbit", "prism", "wave", "spark", "grid", "bloom"] as const;
export type AgentGlyph = (typeof AGENT_GLYPHS)[number];

/** The kind of work an agent does; it shapes its method, defaults and model routing. */
export const SPECIALTIES = ["assistant", "research", "writing", "analysis", "planning", "support", "engineering"] as const;
export type Specialty = (typeof SPECIALTIES)[number];

export const RESPONSE_STYLES = ["concise", "balanced", "detailed"] as const;
export type ResponseStyle = (typeof RESPONSE_STYLES)[number];

/** auto: a model is picked for each message; fixed: always the agent's model. */
export const MODEL_MODES = ["auto", "fixed"] as const;
export type ModelMode = (typeof MODEL_MODES)[number];

export type AgentVisibility = "workspace" | "private";

/** How far an agent strays from the most likely wording: exact for facts and code, freer for ideas. */
export const CREATIVITY_LEVELS = ["precise", "balanced", "creative"] as const;
export type Creativity = (typeof CREATIVITY_LEVELS)[number];

/** A worked example of a message and the reply the team wants for it. */
export interface AgentExample {
  prompt: string;
  reply: string;
}

export interface Agent {
  id: string;
  workspaceId: string;
  createdBy: string | null;
  name: string;
  handle: string;
  tagline: string;
  instructions: string;
  /** Reference facts from the team that the agent treats as reliable. */
  knowledge: string;
  /** Always/never rules that override its general method. */
  rules: string;
  examples: AgentExample[];
  creativity: Creativity;
  /** Reviews each draft against the evidence before it's final. */
  doubleCheck: boolean;
  specialty: Specialty;
  responseStyle: ResponseStyle;
  modelMode: ModelMode;
  /** The model used in fixed mode, and the fallback in auto mode. */
  model: string;
  tools: AgentToolId[];
  starters: string[];
  color: PersonColor;
  glyph: AgentGlyph;
  visibility: AgentVisibility;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** thinking → working (text arriving) → done | failed | cancelled */
export type AgentRunStatus = "thinking" | "working" | "done" | "failed" | "cancelled";

export interface AgentRunStep {
  kind: "read" | "tool" | "web" | "note";
  label: string;
}

/** How a run's model was chosen. */
export interface AgentRoute {
  mode: "auto" | "fixed" | "override";
  tier: string | null;
  reason: string | null;
}

export interface AgentRun {
  runId: string;
  status: AgentRunStatus;
  model: string | null;
  /** The person whose message started the run; they (or an admin) can stop it. */
  requestedBy: string | null;
  route: AgentRoute | null;
  steps: AgentRunStep[];
  credits: number | null;
  error: string | null;
}

/** Live progress of a reply that is still being written, from the conversation channel. */
export interface AgentStream {
  runId: string;
  seq: number;
  status: "thinking" | "working";
  text: string;
  steps: AgentRunStep[];
  receivedAt: number;
}

/** A person's AI credits. They follow the account across workspaces. */
export interface CreditAccount {
  balance: number;
  reserved: number;
  lifetimeGranted: number;
  lifetimeUsed: number;
}

// Tasks ───────────────────────────────────────────────────────────────────────

export const TASK_STATUSES = ["todo", "in_progress", "blocked", "done", "cancelled"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["none", "low", "medium", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export interface Task {
  id: string;
  workspaceId: string;
  /** Counts up per workspace: T-1, T-2… */
  number: number;
  title: string;
  description: string;
  status: TaskStatus;
  priority: TaskPriority;
  /** A person or an agent does the task, never both. */
  assigneeId: string | null;
  agentId: string | null;
  /** A calendar date, YYYY-MM-DD. */
  dueOn: string | null;
  /** The chat it came from, and the message it was made from. */
  conversationId: string | null;
  messageId: string | null;
  createdBy: string | null;
  /** Set when an agent created it for the person who asked. */
  createdByAgent: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

/** A task being written before it exists: what the dialog opens with. */
export interface TaskDraft {
  title?: string;
  description?: string;
  priority?: TaskPriority;
  assigneeId?: string | null;
  agentId?: string | null;
  dueOn?: string | null;
  conversationId?: string | null;
  messageId?: string | null;
}

// Connected apps ──────────────────────────────────────────────────────────────

export type IntegrationProvider = "github";

export interface Integration {
  id: string;
  workspaceId: string;
  provider: IntegrationProvider;
  /** The GitHub account or organization the app is installed on. */
  accountLogin: string;
  accountType: string;
  /** "owner/name" agents use when nobody names a repository. */
  defaultRepo: string | null;
  connectedBy: string | null;
  createdAt: string;
}

export interface UsageBucket {
  credits: number;
  runs: number;
}

export interface UsageSummary {
  timeZone: string;
  since: string;
  account: CreditAccount | null;
  days: (UsageBucket & { day: string })[];
  agents: (UsageBucket & { agentId: string | null; name: string | null })[];
  models: (UsageBucket & { model: string })[];
  workspaces: (UsageBucket & { workspaceId: string; name: string })[];
}
