"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type DragEvent } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { fetchConversation } from "@/features/workspace/api/conversations";
import { useConversationChannel } from "@/features/workspace/realtime/use-conversation-channel";
import { useWorkspace, useWorkspaceStore } from "@/features/workspace/store/workspace-provider";
import { usePreferences } from "@/lib/preferences";
import { routes } from "@/lib/routes";

import { useAttachmentUploads } from "../hooks/use-attachment-uploads";
import { Composer } from "./composer";
import { ConversationHeader } from "./conversation-header";
import { DetailsPanel } from "./details-panel";
import { MessageList } from "./message-list";

interface ConversationScreenProps {
  conversationId: string;
  focusMessageId?: string;
}

export function ConversationScreen({ conversationId, focusMessageId }: ConversationScreenProps) {
  const store = useWorkspaceStore();
  const conversation = useWorkspace((state) => state.conversations[conversationId]);
  const workspaceId = useWorkspace((state) => state.workspace.id);
  const slug = useWorkspace((state) => state.workspace.slug);
  const [missing, setMissing] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const [preferences] = usePreferences();
  const uploads = useAttachmentUploads(conversationId);
  const channel = useConversationChannel(conversationId);

  useEffect(() => {
    store.getState().setActiveConversation(conversationId);
    return () => {
      if (store.getState().activeConversationId === conversationId) {
        store.getState().setActiveConversation(null);
      }
      store.getState().setEditingMessage(null);
    };
  }, [conversationId, store]);

  useEffect(() => {
    if (store.getState().conversations[conversationId]) return;
    let cancelled = false;
    fetchConversation(workspaceId, conversationId)
      .then((result) => {
        if (cancelled) return;
        if (result) store.getState().upsertConversation(result);
        else setMissing(true);
      })
      .catch(() => {
        if (!cancelled) setMissing(true);
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, workspaceId, store]);

  if (!conversation) {
    return missing ? (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="font-display text-2xl font-semibold tracking-[-0.02em]">This chat isn’t available.</p>
        <p className="max-w-sm text-sm text-ink-3">It may have been removed, or you’re no longer part of it.</p>
        <Button asChild variant="secondary" className="mt-2">
          <Link href={routes.workspace(slug)}>Back to chats</Link>
        </Button>
      </div>
    ) : (
      <div className="flex flex-1 items-center justify-center">
        <Spinner className="text-ink-3" />
      </div>
    );
  }

  const hasFiles = (event: DragEvent) => event.dataTransfer.types.includes("Files");

  return (
    <div className="flex h-full min-h-0">
      <section
        className="relative flex min-w-0 flex-1 flex-col"
        onDragEnter={(event) => {
          if (!hasFiles(event)) return;
          dragDepth.current += 1;
          setDragging(true);
        }}
        onDragOver={(event) => {
          if (hasFiles(event)) event.preventDefault();
        }}
        onDragLeave={(event) => {
          if (!hasFiles(event)) return;
          dragDepth.current = Math.max(0, dragDepth.current - 1);
          if (dragDepth.current === 0) setDragging(false);
        }}
        onDrop={(event) => {
          if (!hasFiles(event)) return;
          event.preventDefault();
          dragDepth.current = 0;
          setDragging(false);
          uploads.addFiles(event.dataTransfer.files);
        }}
      >
        <ConversationHeader
          conversation={conversation}
          detailsOpen={detailsOpen}
          onToggleDetails={() => setDetailsOpen((open) => !open)}
        />
        <div className="backdrop-pattern flex min-h-0 flex-1 flex-col" data-pattern={preferences.pattern}>
          <MessageList conversation={conversation} focusMessageId={focusMessageId} />
          <Composer
            conversation={conversation}
            uploads={uploads}
            onTyping={channel.sendTyping}
            onStopTyping={channel.stopTyping}
          />
        </div>

        {dragging ? (
          <div className="pointer-events-none absolute inset-3 z-20 flex animate-fade-in items-center justify-center rounded-[28px] border-2 border-dashed border-ink-3 bg-paper/85">
            <p className="font-display text-2xl font-semibold tracking-[-0.02em]">Drop to attach</p>
          </div>
        ) : null}
      </section>

      {detailsOpen ? <DetailsPanel conversation={conversation} onClose={() => setDetailsOpen(false)} /> : null}
    </div>
  );
}
