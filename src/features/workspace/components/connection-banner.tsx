"use client";

import { useWorkspace } from "../store/workspace-provider";

export function ConnectionBanner() {
  const connection = useWorkspace((state) => state.connection);
  if (connection === "live" || connection === "connecting") return null;

  const offline = connection === "offline";

  return (
    <div
      role="status"
      className="mx-3 mb-2 flex animate-rise items-center gap-2.5 rounded-xl border border-line bg-paper px-3 py-2 text-[13px] text-ink-2"
    >
      <span
        className="size-2 shrink-0 animate-pulse rounded-full"
        style={{ backgroundColor: offline ? "var(--tomato)" : "var(--saffron)" }}
      />
      {offline ? "You're offline. New messages will appear when you're back." : "Reconnecting to live updates…"}
    </div>
  );
}
