import { MESSAGE_GROUP_WINDOW_MINUTES } from "@/lib/constants";
import { minutesApart, sameDay } from "@/lib/dates";
import type { Message, Reaction } from "@/types/domain";

export type TimelineRow =
  | { type: "day"; key: string; iso: string }
  | { type: "unread"; key: string }
  | { type: "system"; key: string; message: Message }
  | { type: "message"; key: string; message: Message; startsGroup: boolean; endsGroup: boolean };

/** True when `message` belongs in the same visual run as `previous`. */
function continues(previous: Message | undefined, message: Message | undefined) {
  return (
    previous !== undefined &&
    message !== undefined &&
    previous.kind === "text" &&
    message.kind === "text" &&
    previous.senderId === message.senderId &&
    previous.agentId === message.agentId &&
    previous.meta.webhook_id === message.meta.webhook_id &&
    sameDay(previous.createdAt, message.createdAt) &&
    minutesApart(previous.createdAt, message.createdAt) <= MESSAGE_GROUP_WINDOW_MINUTES
  );
}

/**
 * Turns a flat message list into what the eye expects: day dividers, a "new"
 * marker at the first unread message, and runs of messages from one person
 * that share a single header.
 */
export function buildTimeline(messages: Message[], unreadAfter: string | null, meId: string): TimelineRow[] {
  const rows: TimelineRow[] = [];
  const threshold = unreadAfter ? Date.parse(unreadAfter) : null;
  let unreadPlaced = false;

  const isFirstUnread = (message: Message | undefined) =>
    !unreadPlaced &&
    threshold !== null &&
    message !== undefined &&
    message.kind === "text" &&
    message.senderId !== meId &&
    Date.parse(message.createdAt) > threshold;

  messages.forEach((message, index) => {
    const previous = messages[index - 1];
    const next = messages[index + 1];

    if (!previous || !sameDay(previous.createdAt, message.createdAt)) {
      rows.push({ type: "day", key: `day-${message.id}`, iso: message.createdAt });
    }

    let dividerHere = false;
    if (isFirstUnread(message)) {
      rows.push({ type: "unread", key: "unread-divider" });
      unreadPlaced = true;
      dividerHere = true;
    }

    if (message.kind === "system") {
      rows.push({ type: "system", key: message.id, message });
      return;
    }

    rows.push({
      type: "message",
      key: message.id,
      message,
      startsGroup: dividerHere || !continues(previous, message),
      endsGroup: !continues(message, next) || isFirstUnread(next),
    });
  });

  return rows;
}

export function groupReactions(reactions: Reaction[]) {
  const groups = new Map<string, string[]>();
  for (const reaction of reactions) {
    groups.set(reaction.emoji, [...(groups.get(reaction.emoji) ?? []), reaction.userId]);
  }
  return [...groups.entries()].map(([emoji, userIds]) => ({ emoji, userIds }));
}
