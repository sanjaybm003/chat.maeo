"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { toast } from "sonner";

import { IconButton } from "@/components/ui/icon-button";
import { IconArrowUp, IconClose, IconPaperclip, IconReply } from "@/components/ui/icons";
import { useWorkspace, useWorkspaceStore } from "@/features/workspace/store/workspace-provider";
import { personColorStyle } from "@/lib/colors";
import { MAX_MESSAGE_LENGTH } from "@/lib/constants";
import { usePreferences } from "@/lib/preferences";
import { cn, firstNameOf, nameOf } from "@/lib/utils";
import type { Conversation } from "@/types/domain";

import type { AttachmentUploads } from "../hooks/use-attachment-uploads";
import { useMessageActions } from "../hooks/use-message-actions";
import { attachmentSummary, conversationTitle, directPartner } from "../lib/conversation-meta";
import { UploadTray } from "./attachments";

interface ComposerProps {
  conversation: Conversation;
  uploads: AttachmentUploads;
  onTyping: () => void;
  onStopTyping: () => void;
}

export function Composer({ conversation, uploads, onTyping, onStopTyping }: ComposerProps) {
  const conversationId = conversation.id;
  const store = useWorkspaceStore();
  const me = useWorkspace((state) => state.me);
  const members = useWorkspace((state) => state.members);
  const replyToId = useWorkspace((state) => state.replyTargets[conversationId]);
  const replyTo = useWorkspace((state) =>
    replyToId ? (state.threads[conversationId]?.messages.find((message) => message.id === replyToId) ?? null) : null,
  );
  const [preferences] = usePreferences();
  const actions = useMessageActions(conversationId);
  const [text, setText] = useState(() => store.getState().drafts[conversationId] ?? "");
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const readyAttachments = uploads.items.flatMap((item) => (item.status === "ready" && item.attachment ? [item.attachment] : []));
  const uploading = uploads.items.some((item) => item.status === "uploading");
  const tooLong = text.length > MAX_MESSAGE_LENGTH;
  const hasContent = text.trim().length > 0 || readyAttachments.length > 0;
  const canSend = hasContent && !uploading && !tooLong;

  useLayoutEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${Math.min(element.scrollHeight, 220)}px`;
  }, [text]);

  useEffect(() => {
    if (window.matchMedia("(hover: hover)").matches) textareaRef.current?.focus();
  }, [conversationId, replyToId]);

  function submit() {
    if (!canSend) {
      if (uploading && hasContent) toast("Still uploading. It’ll be ready in a moment.");
      return;
    }
    void actions.send({ body: text.trim(), attachments: readyAttachments, replyTo });
    setText("");
    store.getState().setDraft(conversationId, "");
    store.getState().setReplyTarget(conversationId, undefined);
    uploads.clear();
    onStopTyping();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;

    if (event.key === "Enter") {
      const send = preferences.enterToSend ? !event.shiftKey : event.metaKey || event.ctrlKey;
      if (send) {
        event.preventDefault();
        submit();
      }
      return;
    }

    if (event.key === "Escape" && replyToId) {
      event.preventDefault();
      store.getState().setReplyTarget(conversationId, undefined);
      return;
    }

    if (event.key === "ArrowUp" && text.length === 0) {
      const own = [...(store.getState().threads[conversationId]?.messages ?? [])]
        .reverse()
        .find((message) => message.senderId === me.id && message.kind === "text" && !message.deletedAt && message.delivery === "sent" && message.body);
      if (own) {
        event.preventDefault();
        store.getState().setEditingMessage(own.id);
      }
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files);
    if (files.length > 0) {
      event.preventDefault();
      uploads.addFiles(files);
    }
  }

  const partner = directPartner(conversation, members, me.id);
  const placeholder =
    conversation.kind === "direct"
      ? `Message ${firstNameOf(partner, "them")}`
      : `Message ${conversationTitle(conversation, members, me.id)}`;
  const replyAuthor = replyTo?.senderId ? members[replyTo.senderId] : null;

  return (
    <div className="shrink-0 px-3 pb-3 pt-1 sm:px-6 sm:pb-5">
      <div className="mx-auto w-full max-w-[880px]">
        <div
          className={cn(
            "overflow-hidden rounded-[24px] border bg-surface transition-[border-color,box-shadow] duration-150",
            "border-line-2 focus-within:border-ink-4 focus-within:shadow-[0_0_0_4px_color-mix(in_srgb,var(--ink)_5%,transparent)]",
            tooLong && "border-danger",
          )}
        >
          {replyTo ? (
            <div className="flex items-center gap-3 border-b border-line px-4 py-2.5" style={replyAuthor ? personColorStyle(replyAuthor.color) : undefined}>
              <IconReply size={16} className="shrink-0 text-person" />
              <div className="min-w-0 flex-1 text-[13px]">
                <p className="text-ink-3">
                  Replying to <span className="font-semibold text-person-ink">{replyTo.senderId === me.id ? "yourself" : nameOf(replyAuthor)}</span>
                </p>
                <p className="truncate text-ink-2">{replyTo.body || attachmentSummary(replyTo.attachments.length)}</p>
              </div>
              <button
                type="button"
                onClick={() => store.getState().setReplyTarget(conversationId, undefined)}
                className="flex size-7 items-center justify-center rounded-full text-ink-3 hover:bg-paper hover:text-ink"
                aria-label="Cancel reply"
              >
                <IconClose size={15} />
              </button>
            </div>
          ) : null}

          <UploadTray items={uploads.items} onRemove={uploads.remove} onRetry={uploads.retry} />

          <div className="flex items-end gap-1 p-1.5">
            <IconButton label="Attach files" onClick={() => fileInputRef.current?.click()} className="shrink-0">
              <IconPaperclip />
            </IconButton>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                if (event.target.files) uploads.addFiles(event.target.files);
                event.target.value = "";
              }}
            />
            <textarea
              ref={textareaRef}
              rows={1}
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                store.getState().setDraft(conversationId, event.target.value);
                if (event.target.value) onTyping();
                else onStopTyping();
              }}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onBlur={onStopTyping}
              placeholder={placeholder}
              aria-label={placeholder}
              className="max-h-[220px] min-h-9 flex-1 resize-none bg-transparent px-1.5 py-[7px] text-[15px] leading-[22px] text-ink outline-none placeholder:text-ink-4"
            />
            <button
              type="button"
              onClick={submit}
              disabled={!canSend}
              style={personColorStyle(me.color)}
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-full transition-[background-color,transform] duration-150",
                canSend ? "bg-person text-person-on hover:scale-105 active:scale-95" : "bg-paper-2 text-ink-4",
              )}
              aria-label="Send message"
            >
              <IconArrowUp size={18} strokeWidth={2} />
            </button>
          </div>
        </div>

        <div className="mt-1.5 hidden h-4 items-center justify-between px-3 font-mono text-[10.5px] text-ink-4 sm:flex">
          <span>
            {preferences.enterToSend ? "enter to send · shift + enter for a new line" : "ctrl + enter to send"}
          </span>
          {text.length > MAX_MESSAGE_LENGTH - 400 ? (
            <span className={cn(tooLong && "text-danger")}>
              {text.length} / {MAX_MESSAGE_LENGTH}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
