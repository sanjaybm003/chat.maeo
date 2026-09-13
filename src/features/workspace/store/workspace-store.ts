import { createStore } from "zustand/vanilla";

import { createConversationsSlice } from "./slices/conversations";
import { createDirectorySlice } from "./slices/directory";
import { createPresenceSlice } from "./slices/presence";
import { createThreadsSlice } from "./slices/threads";
import { createUiSlice } from "./slices/ui";
import type { WorkspaceBootstrap, WorkspaceStoreState } from "./types";

export type {
  ConnectionState,
  DialogState,
  PresenceEntry,
  SyncCursor,
  Thread,
  WorkspaceBootstrap,
  WorkspaceStoreState,
} from "./types";

/**
 * One store per open workspace, composed from focused slices:
 *   directory      who and where: me, workspace, members, invitations
 *   conversations  the chat list, unread counts, read receipts
 *   threads        loaded messages, sync cursors, eviction
 *   presence       online/away, typing, connection state
 *   ui             drafts, reply targets, dialogs
 */
export function createWorkspaceStore(bootstrap: WorkspaceBootstrap) {
  return createStore<WorkspaceStoreState>()((set, get) => ({
    ...createDirectorySlice(set, get, bootstrap),
    ...createConversationsSlice(set, get, bootstrap),
    ...createThreadsSlice(set, get, bootstrap),
    ...createPresenceSlice(set, get, bootstrap),
    ...createUiSlice(set, get, bootstrap),
  }));
}

export type WorkspaceStore = ReturnType<typeof createWorkspaceStore>;
