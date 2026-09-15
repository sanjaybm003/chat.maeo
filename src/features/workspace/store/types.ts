import type { StoreApi } from "zustand/vanilla";

import type {
  Agent,
  AgentStream,
  Conversation,
  CreditAccount,
  Integration,
  Member,
  Message,
  PendingInvitation,
  PresenceStatus,
  Profile,
  Reaction,
  Task,
  TaskDraft,
  Workspace,
  WorkspaceRole,
  WorkspaceSummary,
} from "@/types/domain";

export interface AiBootstrap {
  /** False until the AI migration has been applied to the database. */
  ready: boolean;
  /** Ids of the models this server has API keys for, in preference order. */
  models: string[];
  /** Whether any available model can search the web (Claude on Bedrock can't). */
  webSearch: boolean;
  agents: Agent[];
  credits: CreditAccount | null;
}

export interface TasksBootstrap {
  /** False until the tasks migration has been applied to the database. */
  ready: boolean;
  /** Open tasks and anything finished in the last month. */
  items: Task[];
}

export interface IntegrationsBootstrap {
  /** Whether this server has a GitHub App to connect with. */
  githubAvailable: boolean;
  items: Integration[];
}

export interface WorkspaceBootstrap {
  me: Profile;
  workspace: Workspace;
  myRole: WorkspaceRole;
  workspaces: WorkspaceSummary[];
  members: Member[];
  conversations: Conversation[];
  pendingInvitations: PendingInvitation[];
  ai: AiBootstrap;
  tasks: TasksBootstrap;
  integrations: IntegrationsBootstrap;
}

/** Position in a conversation's change feed: the newest (updated_at, id) seen from the server. */
export interface SyncCursor {
  at: string;
  id: string;
}

export interface Thread {
  /** Oldest first. */
  messages: Message[];
  status: "loading" | "ready" | "error";
  hasMore: boolean;
  loadingOlder: boolean;
  cursor: SyncCursor | null;
  /** Drives least-recently-viewed eviction. */
  lastViewedAt: number;
}

export type ConnectionState = "connecting" | "live" | "reconnecting" | "offline";

export type DialogState =
  | { name: "new-chat" }
  | { name: "invite" }
  | { name: "palette" }
  | { name: "add-people"; conversationId: string }
  /** A new task when there's no taskId, starting from the draft; otherwise that task. */
  | { name: "task"; taskId?: string; draft?: TaskDraft };

export interface PresenceEntry {
  userId: string;
  status: PresenceStatus;
}

export interface DirectorySlice {
  me: Profile;
  workspace: Workspace;
  myRole: WorkspaceRole;
  workspaces: WorkspaceSummary[];
  members: Record<string, Member>;
  pendingInvitations: PendingInvitation[];

  hydrate: (bootstrap: WorkspaceBootstrap) => void;
  setMe: (me: Profile) => void;
  setWorkspace: (workspace: Workspace) => void;
  setMembers: (members: Member[]) => void;
  upsertMember: (member: Member) => void;
  removeMember: (userId: string) => void;
}

export interface ConversationsSlice {
  conversations: Record<string, Conversation>;
  activeConversationId: string | null;

  setConversations: (conversations: Conversation[]) => void;
  upsertConversation: (conversation: Conversation) => void;
  patchConversation: (conversationId: string, patch: Partial<Conversation>) => void;
  removeConversation: (conversationId: string) => void;
  setActiveConversation: (conversationId: string | null) => void;
  incrementUnread: (conversationId: string) => void;
  setParticipantRead: (conversationId: string, userId: string, lastReadAt: string) => void;
}

export interface ThreadsSlice {
  threads: Record<string, Thread>;

  startThreadLoad: (conversationId: string) => void;
  /** First page loaded; keeps anything that arrived while loading. */
  setThread: (conversationId: string, messages: Message[], hasMore: boolean) => void;
  /** Replaces a thread that fell too far behind, keeping only unsent messages. */
  resetThread: (conversationId: string, messages: Message[], hasMore: boolean) => void;
  failThread: (conversationId: string) => void;
  setLoadingOlder: (conversationId: string, loading: boolean) => void;
  prependMessages: (conversationId: string, messages: Message[], hasMore: boolean) => void;
  /** Merges complete server rows (with reactions) using last-writer-wins on version. */
  applyChanges: (conversationId: string, messages: Message[]) => void;
  /** One message from anywhere: optimistic, confirmed, or realtime. */
  receiveMessage: (message: Message, options?: { keepReactions?: boolean }) => void;
  patchMessage: (conversationId: string, messageId: string, patch: Partial<Message>) => void;
  removeMessage: (conversationId: string, messageId: string) => void;
  applyReaction: (conversationId: string, messageId: string, reaction: Reaction, added: boolean) => void;
  /** Marks a thread as just viewed and evicts cold ones beyond the cache size. */
  retainThread: (conversationId: string) => void;
}

export interface PresenceSlice {
  online: Record<string, true>;
  away: Record<string, true>;
  /** conversationId → userId → expiry timestamp */
  typing: Record<string, Record<string, number>>;
  connection: ConnectionState;

  setPresence: (entries: PresenceEntry[]) => void;
  setTyping: (conversationId: string, userId: string, typing: boolean) => void;
  pruneTyping: () => void;
  setConnection: (connection: ConnectionState) => void;
}

export interface UiSlice {
  drafts: Record<string, string>;
  replyTargets: Record<string, string | undefined>;
  editingMessageId: string | null;
  dialog: DialogState | null;
  activityElsewhere: boolean;
  /** The agent panel above the message bar, open for one conversation at a time. */
  agentPanel: { conversationId: string; prompt?: string } | null;
  /** Text another part of the screen handed to one chat's message bar, taken once. */
  composerInsert: { conversationId: string; text: string; id: number } | null;

  setDraft: (conversationId: string, text: string) => void;
  setReplyTarget: (conversationId: string, messageId: string | undefined) => void;
  setEditingMessage: (messageId: string | null) => void;
  openDialog: (dialog: DialogState) => void;
  closeDialog: () => void;
  flagActivityElsewhere: (active: boolean) => void;
  openAgentPanel: (conversationId: string, prompt?: string) => void;
  closeAgentPanel: () => void;
  insertIntoComposer: (conversationId: string, text: string) => void;
  takeComposerInsert: (id: number) => void;
}

/** Agents just called on by a message sent from this device, shown until their replies appear. */
export interface PendingReplies {
  messageId: string;
  agentIds: string[];
  since: number;
}

export interface AiSlice {
  /** conversationId → the latest message sent here that is waiting on agents. */
  pendingReplies: Record<string, PendingReplies>;
  markRepliesPending: (conversationId: string, messageId: string, agentIds: string[]) => void;
  /** Clears the conversation's wait, or only the wait for that message when one is given. */
  clearPendingReplies: (conversationId: string, messageId?: string) => void;
  aiReady: boolean;
  aiModels: string[];
  aiWebSearch: boolean;
  /** Every agent this person can see, archived ones included so old replies keep their author. */
  agents: Record<string, Agent>;
  credits: CreditAccount | null;
  /** messageId → live progress of an agent reply that is still being written. */
  agentStreams: Record<string, AgentStream>;

  upsertAgent: (agent: Agent) => void;
  removeAgent: (agentId: string) => void;
  setCredits: (credits: CreditAccount) => void;
  setCreditBalance: (balance: number) => void;
  /** Ignored unless the message is a live reply of the same run: a stale or spoofed snapshot never shows. */
  applyAgentStream: (conversationId: string, messageId: string, stream: AgentStream) => void;
}

export interface TasksSlice {
  tasksReady: boolean;
  tasks: Record<string, Task>;

  setTasks: (tasks: Task[]) => void;
  /** Keeps the newer copy when two versions of a task cross paths. */
  upsertTask: (task: Task) => void;
  removeTask: (taskId: string) => void;
}

export interface IntegrationsSlice {
  githubAvailable: boolean;
  integrations: Integration[];

  setIntegrations: (integrations: Integration[]) => void;
}

export type WorkspaceStoreState = DirectorySlice &
  ConversationsSlice &
  ThreadsSlice &
  PresenceSlice &
  UiSlice &
  AiSlice &
  TasksSlice &
  IntegrationsSlice;

export type SetState = StoreApi<WorkspaceStoreState>["setState"];
export type GetState = StoreApi<WorkspaceStoreState>["getState"];
export type SliceCreator<Slice> = (set: SetState, get: GetState, bootstrap: WorkspaceBootstrap) => Slice;
