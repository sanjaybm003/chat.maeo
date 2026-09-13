import { kv } from "@/lib/browser/idb";

import type { OutboxEntry, OutboxStorage } from "./outbox";

function isEntry(value: unknown): value is OutboxEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "string" &&
    typeof entry.conversationId === "string" &&
    typeof entry.senderId === "string" &&
    typeof entry.body === "string" &&
    typeof entry.createdAt === "string" &&
    Array.isArray(entry.attachments) &&
    (entry.state === "pending" || entry.state === "failed")
  );
}

/** One queue per person per workspace, in IndexedDB. */
export function createOutboxStorage(userId: string, workspaceId: string): OutboxStorage {
  const key = `outbox:v1:${userId}:${workspaceId}`;
  return {
    async load() {
      const value = await kv.get<unknown>(key);
      return Array.isArray(value) ? value.filter(isEntry) : [];
    },
    async save(entries) {
      if (entries.length === 0) await kv.delete(key);
      else await kv.set(key, entries);
    },
  };
}
