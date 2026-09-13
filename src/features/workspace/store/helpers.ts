import { previewOf } from "@/lib/mappers";
import type { AgentStream, Conversation, Message } from "@/types/domain";

import type { SyncCursor, Thread } from "./types";

export const time = (iso: string) => Date.parse(iso) || 0;

/**
 * Orders server timestamps. Millisecond precision first; identical formats
 * (Postgres emits microseconds) then compare lexicographically for the rest.
 */
export function compareTimestamps(a: string, b: string) {
  const diff = time(a) - time(b);
  if (diff !== 0) return diff;
  return a < b ? -1 : a > b ? 1 : 0;
}

export function compareMessages(a: Message, b: Message) {
  return compareTimestamps(a.createdAt, b.createdAt) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

export function indexBy<T extends { id: string }>(items: T[]) {
  const result: Record<string, T> = {};
  for (const item of items) result[item.id] = item;
  return result;
}

export function latestOf(a: string, b: string) {
  return time(a) >= time(b) ? a : b;
}

/** Inserts or replaces by id, keeping chronological order (append is the fast path). */
export function upsertSorted(list: Message[], message: Message) {
  const index = list.findIndex((item) => item.id === message.id);
  if (index === -1) {
    if (list.length === 0 || compareMessages(list[list.length - 1], message) <= 0) return [...list, message];
    return [...list, message].sort(compareMessages);
  }
  const next = list.slice();
  next[index] = message;
  const outOfOrder =
    (index > 0 && compareMessages(next[index - 1], message) > 0) ||
    (index < next.length - 1 && compareMessages(message, next[index + 1]) > 0);
  return outOfOrder ? next.sort(compareMessages) : next;
}

export function compareCursors(a: SyncCursor, b: SyncCursor) {
  return compareTimestamps(a.at, b.at) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/** Moves the cursor forward past any server-confirmed message; never backwards. */
export function advanceCursor(cursor: SyncCursor | null, messages: Message[]) {
  let next = cursor;
  for (const message of messages) {
    if (message.delivery !== "sent") continue;
    const candidate = { at: message.updatedAt, id: message.id };
    if (!next || compareCursors(candidate, next) > 0) next = candidate;
  }
  return next;
}

/**
 * Last-writer-wins by server version. Returns null when the incoming copy is
 * older than what we already hold (a late or replayed event), so it's dropped.
 */
export function mergeMessage(existing: Message | undefined, incoming: Message, keepReactions: boolean): Message | null {
  if (!existing) return incoming;
  if (existing.delivery === "sent" && incoming.delivery === "sent" && incoming.version < existing.version) return null;
  return {
    ...incoming,
    reactions: keepReactions ? existing.reactions : incoming.reactions,
    replyTo: incoming.replyTo ?? existing.replyTo,
  };
}

export function mergeIntoThread(thread: Thread, incoming: Message[], keepReactions: boolean) {
  let messages = thread.messages;
  const applied: Message[] = [];
  for (const message of incoming) {
    const merged = mergeMessage(
      messages.find((item) => item.id === message.id),
      message,
      keepReactions,
    );
    if (!merged) continue;
    messages = upsertSorted(messages, merged);
    applied.push(merged);
  }
  return { thread: { ...thread, messages, cursor: advanceCursor(thread.cursor, applied) }, applied };
}

export const isRunLive = (message: Pick<Message, "run">) =>
  message.run?.status === "thinking" || message.run?.status === "working";

/** Drops live streams for agent replies that just finished, or null if none did. */
export function withoutFinishedStreams(streams: Record<string, AgentStream>, messages: Message[]) {
  const finished = messages.filter((message) => message.run && !isRunLive(message) && streams[message.id]);
  if (finished.length === 0) return null;
  const next = { ...streams };
  for (const message of finished) delete next[message.id];
  return next;
}

/** The conversation with its preview moved to the newest of `messages`, or null if unchanged. */
export function withLatestPreview(conversation: Conversation | undefined, messages: Message[]) {
  if (!conversation || messages.length === 0) return null;
  let next = conversation;
  let changed = false;
  for (const message of messages) {
    const last = next.lastMessage;
    const isLatest = !last || last.id === message.id || time(last.createdAt) <= time(message.createdAt);
    if (!isLatest) continue;
    next = {
      ...next,
      lastMessage: previewOf(message),
      lastMessageAt: message.delivery === "sent" ? message.createdAt : (next.lastMessageAt ?? message.createdAt),
    };
    changed = true;
  }
  return changed ? next : null;
}
