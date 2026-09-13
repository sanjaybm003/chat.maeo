import { z } from "zod";

/**
 * Runtime contracts for realtime payloads. Anything that fails to parse is
 * dropped, so a malformed or spoofed broadcast can never corrupt the store.
 * Message rows are validated by mapMessage in lib/mappers.
 */

const id = z.guid();

export const reactionEventSchema = z
  .object({ message_id: id, conversation_id: id, user_id: id, emoji: z.string().min(1).max(16) })
  .transform((value) => ({
    messageId: value.message_id,
    conversationId: value.conversation_id,
    userId: value.user_id,
    emoji: value.emoji,
  }));

export const readEventSchema = z
  .object({ conversation_id: id, user_id: id, last_read_at: z.string().min(10).max(40) })
  .transform((value) => ({
    conversationId: value.conversation_id,
    userId: value.user_id,
    lastReadAt: value.last_read_at,
  }));

export const conversationRefSchema = z.object({ conversation_id: id }).transform((value) => value.conversation_id);
export const workspaceRefSchema = z.object({ workspace_id: id }).transform((value) => value.workspace_id);
export const userRefSchema = z.object({ user_id: id }).transform((value) => value.user_id);

export const typingEventSchema = z
  .object({ user_id: id, typing: z.boolean().optional() })
  .transform((value) => ({ userId: value.user_id, typing: value.typing !== false }));

export type ReactionEvent = z.output<typeof reactionEventSchema>;
export type ReadEvent = z.output<typeof readEventSchema>;
