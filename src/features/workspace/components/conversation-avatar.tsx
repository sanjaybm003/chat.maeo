"use client";

import { Avatar, GroupAvatar } from "@/components/ui/avatar";
import { conversationPeople, directPartner } from "@/features/chat/lib/conversation-meta";
import type { Conversation } from "@/types/domain";

import { useWorkspace } from "../store/workspace-provider";

export function ConversationAvatar({
  conversation,
  size = "md",
}: {
  conversation: Conversation;
  size?: "sm" | "md" | "lg" | "xl";
}) {
  const members = useWorkspace((state) => state.members);
  const meId = useWorkspace((state) => state.me.id);
  const online = useWorkspace((state) => state.online);

  if (conversation.kind === "direct") {
    const partner = directPartner(conversation, members, meId);
    return <Avatar person={partner} size={size} online={partner ? Boolean(online[partner.id]) : false} />;
  }

  return <GroupAvatar people={conversationPeople(conversation, members, meId).slice(0, 2)} size={size} />;
}
