import { plainText } from "@/features/ai/lib/rich-text";
import type { Message, TaskDraft } from "@/types/domain";

/** A message turned into a task: its first line as the title, the whole message as the details. */
export function taskDraftFromMessage(message: Message): TaskDraft {
  const text = (message.agentId ? plainText(message.body) : message.body).trim();
  const firstLine = (text.split("\n").find((line) => line.trim()) ?? "").replace(/\s+/g, " ").trim();
  const title = firstLine.length > 120 ? `${firstLine.slice(0, 117).trimEnd()}…` : firstLine;
  return {
    title,
    description: text.replace(/\s+/g, " ") === firstLine ? "" : text.slice(0, 8000),
    conversationId: message.conversationId,
    messageId: message.id,
  };
}
