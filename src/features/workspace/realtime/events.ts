import { z } from "zod";

import { mapAgentSteps } from "@/lib/mappers";

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
export const agentRefSchema = z.object({ agent_id: id }).transform((value) => value.agent_id);
export const taskRefSchema = z.object({ task_id: id }).transform((value) => value.task_id);

export const taskAssignedSchema = z
  .object({ task_id: id, by: id })
  .transform((value) => ({ taskId: value.task_id, by: value.by }));

export const typingEventSchema = z
  .object({ user_id: id, typing: z.boolean().optional() })
  .transform((value) => ({ userId: value.user_id, typing: value.typing !== false }));

export const creditsEventSchema = z
  .object({ balance: z.coerce.number().int().nonnegative() })
  .transform((value) => value.balance);

/** A full snapshot of an unfinished agent reply; the newest seq wins. */
export const agentStreamSchema = z
  .object({
    run_id: id,
    message_id: id,
    seq: z.number().int().nonnegative(),
    status: z.enum(["thinking", "working"]),
    text: z.string().max(16_000),
    steps: z.array(z.unknown()).max(40),
  })
  .transform((value) => ({
    messageId: value.message_id,
    stream: {
      runId: value.run_id,
      seq: value.seq,
      status: value.status,
      text: value.text,
      steps: mapAgentSteps(value.steps),
      receivedAt: Date.now(),
    },
  }));

export type ReactionEvent = z.output<typeof reactionEventSchema>;
export type ReadEvent = z.output<typeof readEventSchema>;
export type AgentStreamEvent = z.output<typeof agentStreamSchema>;
