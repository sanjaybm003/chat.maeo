import { colorFromSeed } from "@/lib/colors";
import { firstNameOf, joinNames, nameOf, pluralize } from "@/lib/utils";
import type { Conversation, Member, MessagePreview, PersonColor, SystemMeta } from "@/types/domain";

type Members = Record<string, Member>;

export function otherParticipantIds(conversation: Conversation, meId: string) {
  return conversation.participants.map((participant) => participant.userId).filter((id) => id !== meId);
}

export function directPartner(conversation: Conversation, members: Members, meId: string): Member | null {
  if (conversation.kind !== "direct") return null;
  const otherId = otherParticipantIds(conversation, meId)[0];
  return otherId ? (members[otherId] ?? null) : null;
}

export function conversationPeople(conversation: Conversation, members: Members, meId: string) {
  return otherParticipantIds(conversation, meId).map((id) => members[id] ?? null);
}

export function conversationTitle(conversation: Conversation, members: Members, meId: string) {
  if (conversation.kind === "direct") {
    return nameOf(directPartner(conversation, members, meId));
  }
  if (conversation.name) return conversation.name;
  const names = conversationPeople(conversation, members, meId)
    .filter((member): member is Member => member !== null)
    .map((member) => firstNameOf(member));
  return names.length > 0 ? joinNames(names, 3) : "Just you";
}

export function conversationColor(conversation: Conversation, members: Members, meId: string): PersonColor {
  const partner = directPartner(conversation, members, meId);
  return partner?.color ?? colorFromSeed(conversation.id);
}

function actorName(senderId: string | null, members: Members, meId: string) {
  if (senderId === meId) return "You";
  return firstNameOf(senderId ? members[senderId] : null, "Someone");
}

export function systemMessageText(meta: SystemMeta, senderId: string | null, members: Members, meId: string) {
  const actor = actorName(senderId, members, meId);
  switch (meta.event) {
    case "group_created":
      return meta.name ? `${actor} created “${meta.name}”` : `${actor} started this group`;
    case "members_added": {
      const names = (meta.user_ids ?? []).map((id) => (id === meId ? "you" : firstNameOf(members[id], "a former member")));
      return `${actor} added ${joinNames(names, 4)}`;
    }
    case "member_left":
      return `${actor} left the group`;
    case "renamed":
      return meta.name ? `${actor} renamed the group to “${meta.name}”` : `${actor} removed the group name`;
    default:
      return "Conversation updated";
  }
}

export function attachmentSummary(count: number) {
  return count === 1 ? "Sent an attachment" : `Sent ${pluralize(count, "attachment")}`;
}

export function previewLine(conversation: Conversation, members: Members, meId: string) {
  const preview: MessagePreview | null = conversation.lastMessage;
  if (!preview) return conversation.kind === "group" ? "New group" : "Say hello";
  if (preview.kind === "system") return systemMessageText(preview.meta, preview.senderId, members, meId);

  const content = preview.deletedAt
    ? "Message deleted"
    : preview.body.trim()
      ? preview.body.replace(/\s+/g, " ")
      : attachmentSummary(preview.attachmentCount);

  if (preview.senderId === meId) return `You: ${content}`;
  if (conversation.kind === "group") return `${firstNameOf(preview.senderId ? members[preview.senderId] : null)}: ${content}`;
  return content;
}
