import "server-only";

import type { Json } from "@/types/database";

import type { NameDirectory } from "./directory";

export interface TranscriptMessage {
  id: string;
  sender_id: string | null;
  agent_id: string | null;
  kind: string;
  body: string;
  attachments: Json;
  meta: Json;
  reply_to_id: string | null;
  deleted_at: string | null;
  created_at: string;
}

export const TRANSCRIPT_COLUMNS = "id, sender_id, agent_id, kind, body, attachments, meta, reply_to_id, deleted_at, created_at";

const MAX_MESSAGE_CHARS = 2000;

const stamp = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

function attachmentNames(value: Json) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) =>
    item && typeof item === "object" && !Array.isArray(item) && typeof item.name === "string" ? [item.name] : [],
  );
}

function isUnfinishedAgentReply(message: TranscriptMessage) {
  const meta = message.meta;
  return (
    Boolean(message.agent_id) &&
    !message.body &&
    meta !== null &&
    typeof meta === "object" &&
    !Array.isArray(meta) &&
    meta.status !== "done"
  );
}

/** Text messages worth reading: no system events, no replies still being written. */
export const isTranscriptWorthy = (message: TranscriptMessage) => message.kind === "text" && !isUnfinishedAgentReply(message);

/** One line per message, oldest first, skipping noise a model doesn't need. */
export function formatTranscript(messages: TranscriptMessage[], directory: NameDirectory): string[] {
  const lines: string[] = [];
  for (const message of messages) {
    if (!isTranscriptWorthy(message)) continue;
    const author = directory.authorName(message);
    if (message.deleted_at) {
      lines.push(`[${stamp(message.created_at)}] ${author}: (deleted a message)`);
      continue;
    }
    const files = attachmentNames(message.attachments);
    const body = message.body.length > MAX_MESSAGE_CHARS ? `${message.body.slice(0, MAX_MESSAGE_CHARS)}…` : message.body;
    const attached = files.length ? ` [attached: ${files.join(", ")}]` : "";
    lines.push(`[${stamp(message.created_at)}] ${author}: ${body}${attached}`.trim());
  }
  return lines;
}
