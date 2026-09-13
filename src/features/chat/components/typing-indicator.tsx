"use client";

import { useEffect } from "react";

import { Avatar } from "@/components/ui/avatar";
import { useWorkspace } from "@/features/workspace/store/workspace-provider";
import { firstNameOf, joinNames } from "@/lib/utils";

export function TypingIndicator({ conversationId }: { conversationId: string }) {
  const typing = useWorkspace((state) => state.typing[conversationId]);
  const members = useWorkspace((state) => state.members);
  const pruneTyping = useWorkspace((state) => state.pruneTyping);
  const userIds = Object.keys(typing ?? {});

  useEffect(() => {
    if (userIds.length === 0) return;
    const timer = window.setInterval(pruneTyping, 1000);
    return () => window.clearInterval(timer);
  }, [userIds.length, pruneTyping]);

  if (userIds.length === 0) return null;
  const names = userIds.map((id) => firstNameOf(members[id]));

  return (
    <div className="mt-4 flex animate-rise items-center gap-2.5 px-1" aria-live="polite">
      <div className="flex -space-x-2 [--avatar-ring:var(--paper)]">
        {userIds.slice(0, 3).map((id) => (
          <Avatar key={id} person={members[id]} size="sm" className="rounded-full ring-2 ring-paper" />
        ))}
      </div>
      <div className="flex h-8 items-center gap-1 rounded-full border border-line bg-surface px-3" aria-hidden="true">
        <span className="typing-dot size-1.5 rounded-full bg-ink-3" />
        <span className="typing-dot size-1.5 rounded-full bg-ink-3" />
        <span className="typing-dot size-1.5 rounded-full bg-ink-3" />
      </div>
      <span className="text-[12.5px] text-ink-3">
        {names.length === 1 ? `${names[0]} is typing` : `${joinNames(names, 2)} are typing`}
      </span>
    </div>
  );
}
