"use client";

import Link from "next/link";
import { toast } from "sonner";

import { IconButton } from "@/components/ui/icon-button";
import { IconArrowLeft, IconBell, IconBellOff, IconInfo, IconUserPlus } from "@/components/ui/icons";
import { ConversationAvatar } from "@/features/workspace/components/conversation-avatar";
import { setConversationMuted } from "@/features/workspace/api/conversations";
import { useWorkspace, useWorkspaceStore } from "@/features/workspace/store/workspace-provider";
import { getErrorMessage } from "@/lib/errors";
import { routes } from "@/lib/routes";
import { cn, firstNameOf, joinNames } from "@/lib/utils";
import type { Conversation } from "@/types/domain";

import { conversationPeople, conversationTitle, directPartner } from "../lib/conversation-meta";

interface ConversationHeaderProps {
  conversation: Conversation;
  detailsOpen: boolean;
  onToggleDetails: () => void;
}

export function ConversationHeader({ conversation, detailsOpen, onToggleDetails }: ConversationHeaderProps) {
  const store = useWorkspaceStore();
  const members = useWorkspace((state) => state.members);
  const meId = useWorkspace((state) => state.me.id);
  const slug = useWorkspace((state) => state.workspace.slug);
  const online = useWorkspace((state) => state.online);
  // Select the stored object itself; deriving a new array inside the selector would re-render forever.
  const typing = useWorkspace((state) => state.typing[conversation.id]);
  const openDialog = useWorkspace((state) => state.openDialog);
  const typingIds = typing ? Object.keys(typing) : [];

  const title = conversationTitle(conversation, members, meId);
  const partner = directPartner(conversation, members, meId);

  let subtitle: string;
  if (typingIds.length > 0) {
    subtitle = conversation.kind === "direct" ? "typing…" : `${joinNames(typingIds.map((id) => firstNameOf(members[id])), 2)} typing…`;
  } else if (conversation.kind === "direct") {
    subtitle = partner ? (online[partner.id] ? "Online" : partner.title || partner.email) : "No longer in this workspace";
  } else {
    const people = conversationPeople(conversation, members, meId).filter(Boolean);
    const onlineCount = people.filter((person) => person && online[person.id]).length;
    subtitle = `${conversation.participants.length} people${onlineCount ? ` · ${onlineCount} online` : ""}`;
  }

  async function toggleMute() {
    const muted = !conversation.muted;
    store.getState().patchConversation(conversation.id, { muted });
    try {
      await setConversationMuted(conversation.id, muted);
      toast.success(muted ? "Muted. No sounds or badges from this chat." : "Unmuted.");
    } catch (error) {
      store.getState().patchConversation(conversation.id, { muted: !muted });
      toast.error(getErrorMessage(error));
    }
  }

  return (
    <header className="flex h-16 shrink-0 items-center gap-2 border-b border-line bg-paper px-2 [--avatar-ring:var(--paper)] sm:px-4">
      <Link
        href={routes.workspace(slug)}
        className="flex size-9 items-center justify-center rounded-full text-ink-2 hover:bg-paper-2 md:hidden"
        aria-label="Back to chats"
      >
        <IconArrowLeft />
      </Link>

      <button
        type="button"
        onClick={onToggleDetails}
        className="flex min-w-0 items-center gap-3 rounded-2xl py-1 pl-1 pr-3 text-left transition-colors hover:bg-paper-2"
      >
        <ConversationAvatar conversation={conversation} />
        <span className="min-w-0">
          <span className="block truncate font-display text-[17px] font-semibold leading-tight tracking-[-0.01em] text-ink">
            {title}
          </span>
          <span
            className={cn(
              "block truncate text-[12.5px]",
              typingIds.length > 0 ? "font-medium text-grass" : partner && online[partner.id] ? "text-grass" : "text-ink-3",
            )}
          >
            {subtitle}
          </span>
        </span>
      </button>

      <div className="ml-auto flex shrink-0 items-center gap-0.5">
        <IconButton label={conversation.muted ? "Unmute" : "Mute"} onClick={() => void toggleMute()} tooltipSide="bottom">
          {conversation.muted ? <IconBellOff /> : <IconBell />}
        </IconButton>
        <IconButton
          label={conversation.kind === "direct" ? "Start a group" : "Add people"}
          onClick={() => openDialog({ name: "add-people", conversationId: conversation.id })}
          tooltipSide="bottom"
          className="hidden sm:inline-flex"
        >
          <IconUserPlus />
        </IconButton>
        <IconButton
          label={detailsOpen ? "Hide details" : "Details"}
          onClick={onToggleDetails}
          tooltipSide="bottom"
          className={cn(detailsOpen && "bg-paper-2 text-ink")}
        >
          <IconInfo />
        </IconButton>
      </div>
    </header>
  );
}
