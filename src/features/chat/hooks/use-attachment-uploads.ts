"use client";

import { useCallback, useState } from "react";
import { toast } from "sonner";

import { removeUploadedAttachment, uploadAttachment } from "@/features/workspace/api/attachments";
import { useWorkspace } from "@/features/workspace/store/workspace-provider";
import { getErrorMessage } from "@/lib/errors";
import { isImageType, MAX_ATTACHMENT_BYTES, MAX_ATTACHMENTS_PER_MESSAGE } from "@/lib/storage";
import { formatBytes } from "@/lib/utils";
import type { Attachment } from "@/types/domain";

export interface PendingUpload {
  id: string;
  file: File;
  status: "uploading" | "ready" | "failed";
  previewUrl: string | null;
  attachment?: Attachment;
  error?: string;
}

export type AttachmentUploads = ReturnType<typeof useAttachmentUploads>;

/** Uploads start the moment a file is picked, so sending is instant. */
export function useAttachmentUploads(conversationId: string) {
  const meId = useWorkspace((state) => state.me.id);
  const [items, setItems] = useState<PendingUpload[]>([]);

  const upload = useCallback(
    async (entry: PendingUpload) => {
      try {
        const attachment = await uploadAttachment(conversationId, meId, entry.file);
        let orphaned = false;
        setItems((current) => {
          if (!current.some((item) => item.id === entry.id)) {
            orphaned = true;
            return current;
          }
          return current.map((item) => (item.id === entry.id ? { ...item, status: "ready", attachment } : item));
        });
        if (orphaned) void removeUploadedAttachment(attachment.path);
      } catch (error) {
        setItems((current) =>
          current.map((item) =>
            item.id === entry.id ? { ...item, status: "failed", error: getErrorMessage(error, "Upload failed.") } : item,
          ),
        );
      }
    },
    [conversationId, meId],
  );

  const addFiles = useCallback(
    (files: FileList | File[]) => {
      const incoming = Array.from(files);
      if (incoming.length === 0) return;

      const room = MAX_ATTACHMENTS_PER_MESSAGE - items.length;
      if (room <= 0) {
        toast.error(`You can attach up to ${MAX_ATTACHMENTS_PER_MESSAGE} files per message.`);
        return;
      }

      const tooBig = incoming.filter((file) => file.size > MAX_ATTACHMENT_BYTES);
      if (tooBig.length > 0) {
        toast.error(`${tooBig[0].name} is over ${formatBytes(MAX_ATTACHMENT_BYTES)}.`);
      }

      const accepted = incoming.filter((file) => file.size <= MAX_ATTACHMENT_BYTES).slice(0, room);
      if (incoming.length - tooBig.length > room) {
        toast.error(`Only the first ${room} ${room === 1 ? "file was" : "files were"} added.`);
      }

      const entries: PendingUpload[] = accepted.map((file) => ({
        id: crypto.randomUUID(),
        file,
        status: "uploading",
        previewUrl: isImageType(file.type) ? URL.createObjectURL(file) : null,
      }));
      setItems((current) => [...current, ...entries]);
      entries.forEach((entry) => void upload(entry));
    },
    [items.length, upload],
  );

  const remove = useCallback((id: string) => {
    setItems((current) => {
      const target = current.find((item) => item.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      if (target?.attachment) void removeUploadedAttachment(target.attachment.path);
      return current.filter((item) => item.id !== id);
    });
  }, []);

  const retry = useCallback(
    (id: string) => {
      const target = items.find((item) => item.id === id);
      if (!target) return;
      const next = { ...target, status: "uploading" as const, error: undefined };
      setItems((current) => current.map((item) => (item.id === id ? next : item)));
      void upload(next);
    },
    [items, upload],
  );

  /** After sending: the files now belong to the message, so only previews go. */
  const clear = useCallback(() => {
    setItems((current) => {
      for (const item of current) if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      return [];
    });
  }, []);

  return { items, addFiles, remove, retry, clear };
}
