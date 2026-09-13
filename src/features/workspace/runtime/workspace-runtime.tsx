"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Outbox, outboxEntryToMessage } from "@/features/chat/outbox/outbox";
import { createOutboxStorage } from "@/features/chat/outbox/storage";
import { usePushSync } from "@/features/notifications/use-push-sync";

import { insertMessage } from "../api/messages";
import { useRealtimeSync } from "../realtime/use-realtime-sync";
import { useWorkspaceStore } from "../store/workspace-provider";
import type { WorkspaceStore } from "../store/workspace-store";
import { SyncService } from "../sync/sync-service";

export interface WorkspaceRuntime {
  outbox: Outbox;
  sync: SyncService;
}

const RuntimeContext = createContext<WorkspaceRuntime | null>(null);

function createRuntime(store: WorkspaceStore): WorkspaceRuntime {
  const { me, workspace } = store.getState();

  const outbox = new Outbox({
    storage: createOutboxStorage(me.id, workspace.id),
    transport: {
      send: (entry) =>
        insertMessage({
          id: entry.id,
          conversationId: entry.conversationId,
          senderId: entry.senderId,
          body: entry.body,
          attachments: entry.attachments,
          replyToId: entry.replyToId,
        }),
    },
    listener: {
      onSent: (entry, message) =>
        store.getState().receiveMessage({ ...message, replyTo: message.replyTo ?? entry.replyTo }, { keepReactions: true }),
      onFailed: (entry, error) => {
        store.getState().patchMessage(entry.conversationId, entry.id, { delivery: "failed" });
        toast.error(error.kind === "network" ? "Message not sent. Check your connection and retry." : error.message);
      },
    },
  });

  return { outbox, sync: new SyncService(store) };
}

/**
 * The composition root for a workspace session: the durable outbox, the sync
 * service, the realtime engine and push registration, wired to the store.
 * Renders no markup.
 */
export function WorkspaceRuntimeProvider({ children }: { children: ReactNode }) {
  const store = useWorkspaceStore();
  const [runtime] = useState(() => createRuntime(store));

  useEffect(() => {
    const { outbox, sync } = runtime;
    let cancelled = false;
    outbox.start();
    sync.start();

    void outbox.restore().then((entries) => {
      if (cancelled) return;
      for (const entry of entries) store.getState().receiveMessage(outboxEntryToMessage(entry));
    });

    return () => {
      cancelled = true;
      outbox.stop();
      sync.stop();
    };
  }, [runtime, store]);

  useRealtimeSync(runtime);
  usePushSync();

  return <RuntimeContext value={runtime}>{children}</RuntimeContext>;
}

export function useWorkspaceRuntime(): WorkspaceRuntime {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error("useWorkspaceRuntime must be used inside <WorkspaceRuntimeProvider>");
  return runtime;
}
