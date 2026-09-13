"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useStore } from "zustand";

import {
  createWorkspaceStore,
  type WorkspaceBootstrap,
  type WorkspaceStore,
  type WorkspaceStoreState,
} from "./workspace-store";

const WorkspaceStoreContext = createContext<WorkspaceStore | null>(null);

export function WorkspaceStoreProvider({ bootstrap, children }: { bootstrap: WorkspaceBootstrap; children: ReactNode }) {
  const [store] = useState(() => createWorkspaceStore(bootstrap));

  // A router.refresh() re-renders the layout with fresh server data.
  useEffect(() => {
    store.getState().hydrate(bootstrap);
  }, [bootstrap, store]);

  return <WorkspaceStoreContext value={store}>{children}</WorkspaceStoreContext>;
}

export function useWorkspaceStore(): WorkspaceStore {
  const store = useContext(WorkspaceStoreContext);
  if (!store) throw new Error("useWorkspaceStore must be used inside <WorkspaceStoreProvider>");
  return store;
}

export function useWorkspace<T>(selector: (state: WorkspaceStoreState) => T): T {
  return useStore(useWorkspaceStore(), selector);
}
