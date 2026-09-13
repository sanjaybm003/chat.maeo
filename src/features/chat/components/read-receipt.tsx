"use client";

import { Avatar } from "@/components/ui/avatar";
import { IconCheck, IconChecks } from "@/components/ui/icons";
import { useWorkspace } from "@/features/workspace/store/workspace-provider";
import { joinNames, nameOf } from "@/lib/utils";
import type { Conversation, Message } from "@/types/domain";

/** Shown under your latest message: who has seen it. */
export function ReadReceipt({ conversation, message }: { conversation: Conversation; message: Message }) {
  const members = useWorkspace((state) => state.members);
  const meId = useWorkspace((state) => state.me.id);

  const sentAt = Date.parse(message.createdAt);
  const others = conversation.participants.filter((participant) => participant.userId !== meId);
  const readers = others.filter((participant) => Date.parse(participant.lastReadAt) >= sentAt);

  if (others.length === 0) return null;

  if (conversation.kind === "direct") {
    const seen = readers.length > 0;
    return (
      <p className="mt-1 flex items-center justify-end gap-1 px-1 font-mono text-[10.5px] text-ink-4" aria-live="polite">
        {seen ? <IconChecks size={14} className="text-grass" /> : <IconCheck size={13} />}
        {seen ? "Seen" : "Delivered"}
      </p>
    );
  }

  if (readers.length === 0) {
    return (
      <p className="mt-1 flex items-center justify-end gap-1 px-1 font-mono text-[10.5px] text-ink-4">
        <IconCheck size={13} />
        Delivered
      </p>
    );
  }

  const names = readers.map((reader) => nameOf(members[reader.userId]));
  return (
    <div className="mt-1.5 flex items-center justify-end gap-1.5 px-1" title={`Seen by ${joinNames(names, 10)}`}>
      <div className="flex -space-x-1.5">
        {readers.slice(0, 5).map((reader) => (
          <Avatar key={reader.userId} person={members[reader.userId]} size="xs" className="rounded-full ring-2 ring-paper" />
        ))}
      </div>
      <span className="font-mono text-[10.5px] text-ink-4">
        {readers.length === others.length ? "Seen by everyone" : `Seen by ${readers.length}`}
      </span>
    </div>
  );
}
