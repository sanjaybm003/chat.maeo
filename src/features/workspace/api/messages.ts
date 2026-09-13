import { MESSAGE_PAGE_SIZE } from "@/lib/constants";
import { mapMessage } from "@/lib/mappers";
import type { Json } from "@/types/database";
import type { Attachment, Message } from "@/types/domain";

import type { SyncCursor } from "../store/types";
import { db, isUniqueViolation, unwrap } from "./client";

/** Explicit columns, so the search vector never ships to the browser. */
const MESSAGE_COLUMNS =
  "id, conversation_id, sender_id, kind, body, attachments, meta, reply_to_id, edited_at, deleted_at, created_at, updated_at, version";

function toMessages(rows: readonly unknown[] | null) {
  return (rows ?? []).map(mapMessage).filter((message): message is Message => message !== null);
}

function required(message: Message | null): Message {
  if (!message) throw new Error("The server returned an unexpected message.");
  return message;
}

export async function fetchMessages(conversationId: string, before?: Pick<Message, "createdAt" | "id">) {
  const rows = unwrap(
    await db().rpc("get_messages", {
      p_conversation_id: conversationId,
      p_before_created_at: before?.createdAt ?? null,
      p_before_id: before?.id ?? null,
      p_limit: MESSAGE_PAGE_SIZE,
    }),
  );
  return { messages: toMessages(rows).reverse(), hasMore: (rows?.length ?? 0) === MESSAGE_PAGE_SIZE };
}

/** Everything that changed after `cursor`, oldest change first. */
export async function fetchMessageChanges(conversationId: string, cursor: SyncCursor, limit = 200) {
  return toMessages(
    unwrap(
      await db().rpc("get_message_changes", {
        p_conversation_id: conversationId,
        p_since: cursor.at,
        p_since_id: cursor.id,
        p_limit: limit,
      }),
    ),
  );
}

interface NewMessage {
  id: string;
  conversationId: string;
  senderId: string;
  body: string;
  attachments: Attachment[];
  replyToId: string | null;
}

/** Idempotent: retrying a send that actually reached the server returns the stored row. */
export async function insertMessage(input: NewMessage) {
  const { data, error } = await db()
    .from("messages")
    .insert({
      id: input.id,
      conversation_id: input.conversationId,
      sender_id: input.senderId,
      body: input.body,
      attachments: input.attachments as unknown as Json,
      reply_to_id: input.replyToId,
    })
    .select(MESSAGE_COLUMNS)
    .single();

  if (error) {
    if (isUniqueViolation(error)) {
      return required(mapMessage(unwrap(await db().from("messages").select(MESSAGE_COLUMNS).eq("id", input.id).single())));
    }
    throw error;
  }
  return required(mapMessage(data));
}

export async function editMessage(messageId: string, body: string) {
  return required(
    mapMessage(unwrap(await db().from("messages").update({ body }).eq("id", messageId).select(MESSAGE_COLUMNS).single())),
  );
}

export async function deleteMessage(messageId: string) {
  unwrap(await db().from("messages").update({ deleted_at: new Date().toISOString() }).eq("id", messageId));
}

export async function addReaction(messageId: string, userId: string, emoji: string) {
  const { error } = await db().from("message_reactions").insert({ message_id: messageId, user_id: userId, emoji });
  if (error && !isUniqueViolation(error)) throw error;
}

export async function removeReaction(messageId: string, userId: string, emoji: string) {
  unwrap(await db().from("message_reactions").delete().match({ message_id: messageId, user_id: userId, emoji }));
}

/** Server-ranked: prefix full-text match, trigram similarity and recency. */
export async function searchMessages(workspaceId: string, query: string) {
  const rows = unwrap(await db().rpc("search_messages", { p_workspace_id: workspaceId, p_query: query, p_limit: 20 }));
  return (rows ?? []).map((row) => ({
    id: row.id,
    conversationId: row.conversation_id,
    senderId: row.sender_id,
    body: row.body,
    createdAt: row.created_at,
    rank: row.rank,
  }));
}

export type MessageSearchResult = Awaited<ReturnType<typeof searchMessages>>[number];
