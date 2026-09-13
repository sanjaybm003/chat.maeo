"use client";

import Link from "next/link";
import { memo, useMemo } from "react";

import { Button } from "@/components/ui/button";
import { IconBellOff } from "@/components/ui/icons";
import { CountBadge } from "@/components/ui/kbd";
import { LocalTime } from "@/components/ui/local-time";
import { conversationColor, conversationTitle, previewLine } from "@/features/chat/lib/conversation-meta";
import { personColorStyle } from "@/lib/colors";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import type { Conversation } from "@/types/domain";

import { useWorkspace } from "../store/workspace-provider";
import { ConversationAvatar } from "./conversation-avatar";

export type ConversationFilter = "all" | "unread";

const activityTime = (conversation: Conversation) =>
  Date.parse(conversation.lastMessageAt ?? conversation.createdAt) || 0;

export function ConversationList({ filter, className }: { filter: ConversationFilter; className?: string }) {
  const conversations = useWorkspace((state) => state.conversations);
  const activeId = useWorkspace((state) => state.activeConversationId);
  const hasTeammates = useWorkspace((state) => Object.keys(state.members).length > 1);
  const openDialog = useWorkspace((state) => state.openDialog);

  const visible = useMemo(
    () =>
      Object.values(conversations)
        .filter((item) => filter === "all" || item.unreadCount > 0 || item.id === activeId)
        .sort((a, b) => activityTime(b) - activityTime(a)),
    [conversations, filter, activeId],
  );

  if (visible.length === 0) {
    return (
      <div className={cn("flex flex-col items-start gap-3 px-4 py-6", className)}>
        {filter === "unread" ? (
          <p className="text-[13.5px] text-ink-3">You’re all caught up.</p>
        ) : (
          <>
            <p className="text-[13.5px] leading-relaxed text-ink-3">
              {hasTeammates
                ? "No chats yet. Pick a teammate and say hello."
                : "Nobody else is here yet. Invite your team to start talking."}
            </p>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => openDialog({ name: hasTeammates ? "new-chat" : "invite" })}
            >
              {hasTeammates ? "Start a chat" : "Invite people"}
            </Button>
          </>
        )}
      </div>
    );
  }

  return (
    <div className={cn("overflow-y-auto overscroll-contain px-2 pb-2", className)} role="list">
      {visible.map((conversation) => (
        <ConversationRow key={conversation.id} conversation={conversation} active={conversation.id === activeId} />
      ))}
    </div>
  );
}

const ConversationRow = memo(function ConversationRow({
  conversation,
  active,
}: {
  conversation: Conversation;
  active: boolean;
}) {
  const members = useWorkspace((state) => state.members);
  const meId = useWorkspace((state) => state.me.id);
  const slug = useWorkspace((state) => state.workspace.slug);
  const someoneTyping = useWorkspace((state) => Object.keys(state.typing[conversation.id] ?? {}).length > 0);

  const title = conversationTitle(conversation, members, meId);
  const unread = conversation.unreadCount;
  const lastAt = conversation.lastMessage?.createdAt ?? conversation.lastMessageAt ?? conversation.createdAt;

  return (
    <Link
      role="listitem"
      href={routes.conversation(slug, conversation.id)}
      aria-current={active ? "page" : undefined}
      style={personColorStyle(conversationColor(conversation, members, meId))}
      className={cn(
        "group relative flex items-center gap-3 rounded-2xl px-2.5 py-2.5 transition-colors duration-150",
        active ? "bg-paper-2 [--avatar-ring:var(--paper-2)]" : "hover:bg-paper [&:hover]:[--avatar-ring:var(--paper)]",
      )}
    >
      {active ? <span className="absolute inset-y-3 left-0 w-[3px] rounded-r-full bg-person" aria-hidden="true" /> : null}
      <ConversationAvatar conversation={conversation} />

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2">
          <span className={cn("truncate text-[14.5px] leading-5 text-ink", unread > 0 ? "font-semibold" : "font-medium")}>
            {title}
          </span>
          {conversation.muted ? <IconBellOff size={13} className="shrink-0 self-center text-ink-4" aria-label="Muted" /> : null}
          <LocalTime
            iso={lastAt}
            format="list"
            className={cn("ml-auto shrink-0 font-mono text-[11px]", unread > 0 && !conversation.muted ? "text-accent" : "text-ink-4")}
          />
        </span>
        <span className="mt-0.5 flex items-center gap-2">
          {someoneTyping ? (
            <span className="truncate text-[13px] font-medium text-person-ink">typing…</span>
          ) : (
            <span className={cn("truncate text-[13px] leading-5", unread > 0 ? "text-ink-2" : "text-ink-3")}>
              {previewLine(conversation, members, meId)}
            </span>
          )}
          <CountBadge count={unread} muted={conversation.muted} className="ml-auto shrink-0" />
        </span>
      </span>
    </Link>
  );
});
