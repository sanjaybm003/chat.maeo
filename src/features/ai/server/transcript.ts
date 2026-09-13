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
  deleted_at: string | null;
  created_at: string;
}

export const TRANSCRIPT_COLUMNS = "id, sender_id, agent_id, kind, body, attachments, meta, deleted_at, created_at";

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

/** One line per message, oldest first, skipping noise a model doesn't need. */
export function formatTranscript(messages: TranscriptMessage[], directory: NameDirectory): string[] {
  const lines: string[] = [];
  for (const message of messages) {
    if (message.kind !== "text" || isUnfinishedAgentReply(message)) continue;
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

/** Keeps the most recent lines that fit the budget. */
export function fitToBudget(lines: string[], maxChars: number): { lines: string[]; dropped: number } {
  const kept: string[] = [];
  let used = 0;
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const cost = lines[index].length + 1;
    if (used + cost > maxChars && kept.length > 0) return { lines: kept.reverse(), dropped: index + 1 };
    kept.push(lines[index]);
    used += cost;
  }
  return { lines: kept.reverse(), dropped: 0 };
}
