"use client";

import { useSelectedLayoutSegments } from "next/navigation";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

import { useGlobalShortcuts, useRememberWorkspace, useUnreadTitle } from "../hooks/use-shell-effects";
import { WorkspaceRuntimeProvider } from "../runtime/workspace-runtime";
import { Sidebar } from "./sidebar";
import { WorkspaceDialogs } from "./workspace-dialogs";

export function WorkspaceShell({ children }: { children: ReactNode }) {
  return (
    <WorkspaceRuntimeProvider>
      <ShellFrame>{children}</ShellFrame>
    </WorkspaceRuntimeProvider>
  );
}

function ShellFrame({ children }: { children: ReactNode }) {
  useUnreadTitle();
  useRememberWorkspace();
  useGlobalShortcuts();

  // On phones the sidebar is the home screen and every other page replaces it.
  const showingDetail = useSelectedLayoutSegments().length > 0;

  return (
    <div className="flex h-dvh overflow-hidden bg-paper">
      <Sidebar className={showingDetail ? "hidden md:flex" : "flex"} />
      <main className={cn("relative min-w-0 flex-1 flex-col", showingDetail ? "flex" : "hidden md:flex")}>
        {children}
      </main>
      <WorkspaceDialogs />
    </div>
  );
}
