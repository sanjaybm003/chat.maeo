"use client";

import { usePathname } from "next/navigation";
import { useEffect } from "react";

import { LAST_WORKSPACE_COOKIE } from "@/lib/constants";

import { useWorkspace } from "../store/workspace-provider";

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

export function useGlobalShortcuts() {
  const openDialog = useWorkspace((state) => state.openDialog);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openDialog({ name: "palette" });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [openDialog]);
}
