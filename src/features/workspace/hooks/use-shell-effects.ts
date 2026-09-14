"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { LAST_WORKSPACE_COOKIE } from "@/lib/constants";

import { useWorkspace, useWorkspaceStore } from "../store/workspace-provider";

/** "(3) Priya · maeosan" — unread count first, where it's visible in the tab. */
export function useUnreadTitle() {
  const pathname = usePathname();
  const total = useWorkspace((state) =>
    Object.values(state.conversations).reduce((sum, item) => sum + (item.muted ? 0 : item.unreadCount), 0),
  );

  useEffect(() => {
    const apply = () => {
      const base = document.title.replace(/^\(\d+\+?\)\s/, "");
      document.title = total > 0 ? `(${total > 99 ? "99+" : total}) ${base}` : base;
    };
    apply();
    // Next.js sets the page title after navigation commits; apply again after it.
    const timer = window.setTimeout(apply, 60);
    return () => window.clearTimeout(timer);
  }, [total, pathname]);
}

export function useRememberWorkspace() {
  const slug = useWorkspace((state) => state.workspace.slug);

  useEffect(() => {
    document.cookie = `${LAST_WORKSPACE_COOKIE}=${encodeURIComponent(slug)}; path=/; max-age=31536000; samesite=lax`;
  }, [slug]);
}

/** Typing somewhere, or working inside a dialog or menu: single-key shortcuts stay out of the way. */
function isBusyTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) ||
    target.closest("[role=dialog], [role=menu], [role=listbox]") !== null
  );
}

export function useGlobalShortcuts() {
  const store = useWorkspaceStore();
  const openDialog = useWorkspace((state) => state.openDialog);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openDialog({ name: "palette" });
        return;
      }

      // "T" starts a task from anywhere, linked to the chat that's open.
      if (event.key.toLowerCase() === "t" && !event.metaKey && !event.ctrlKey && !event.altKey && !event.repeat && !isBusyTarget(event.target)) {
        const { tasksReady, dialog, activeConversationId } = store.getState();
        if (!tasksReady || dialog) return;
        event.preventDefault();
        openDialog({ name: "task", draft: activeConversationId ? { conversationId: activeConversationId } : {} });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openDialog, store]);
}
