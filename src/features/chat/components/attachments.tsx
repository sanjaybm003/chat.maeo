"use client";

import { Dialog as DialogPrimitive } from "radix-ui";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { IconClose, IconDownload } from "@/components/ui/icons";
import { getAttachmentDownloadUrl } from "@/features/workspace/api/attachments";
import { colorFromSeed, personColorStyle } from "@/lib/colors";
import { isImageType } from "@/lib/storage";
import { cn, formatBytes } from "@/lib/utils";
import type { Attachment } from "@/types/domain";

import { useAttachmentUrl } from "../hooks/use-attachment-url";

const MAX_SINGLE_SIZE = 340;

function extensionOf(name: string) {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1, dot + 5).toUpperCase() : "FILE";
}

async function download(attachment: Attachment) {
  try {
    window.location.assign(await getAttachmentDownloadUrl(attachment));
  } catch {
    toast.error("Couldn't download that file.");
  }
}

export function AttachmentGrid({ attachments }: { attachments: Attachment[] }) {
  const [viewing, setViewing] = useState<Attachment | null>(null);
  const images = attachments.filter((item) => isImageType(item.type));
  const files = attachments.filter((item) => !isImageType(item.type));

  return (
    <div className="flex flex-col gap-1 p-1">
      {images.length > 0 ? (
        <div className={cn("grid gap-1", images.length === 1 ? "grid-cols-1" : "grid-cols-2")}>
          {images.map((image) => (
            <ImageTile key={image.path} attachment={image} single={images.length === 1} onOpen={() => setViewing(image)} />
          ))}
        </div>
      ) : null}
      {files.map((file) => (
        <FileTile key={file.path} attachment={file} />
      ))}
      <ImageViewer attachment={viewing} onClose={() => setViewing(null)} />
    </div>
  );
}

function ImageTile({ attachment, single, onOpen }: { attachment: Attachment; single: boolean; onOpen: () => void }) {
  const { url, failed } = useAttachmentUrl(attachment.path);

  let style: React.CSSProperties | undefined;
  if (single && attachment.width && attachment.height) {
    const scale = Math.min(1, MAX_SINGLE_SIZE / attachment.width, MAX_SINGLE_SIZE / attachment.height);
    style = {
      width: Math.max(120, Math.round(attachment.width * scale)),
      aspectRatio: `${attachment.width} / ${attachment.height}`,
    };
  }

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "relative block max-w-full overflow-hidden rounded-[15px] bg-paper-2",
        single ? (style ? "" : "h-52 w-64") : "aspect-square w-[150px] sm:w-[170px]",
      )}
      style={style}
      aria-label={`Open ${attachment.name}`}
    >
      {url ? (
        // Signed, short-lived URLs: next/image's cache would only hold dead links.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={attachment.name} className="size-full object-cover" loading="lazy" decoding="async" />
      ) : failed ? (
        <span className="absolute inset-0 flex items-center justify-center text-[12px] text-ink-3">Unavailable</span>
      ) : (
        <span className="absolute inset-0 animate-pulse bg-paper-3" />
      )}
    </button>
  );
}

function FileTile({ attachment }: { attachment: Attachment }) {
  const extension = extensionOf(attachment.name);
  return (
    <button
      type="button"
      onClick={() => void download(attachment)}
      className="flex w-full min-w-[220px] max-w-[320px] items-center gap-3 rounded-[15px] border border-line bg-surface p-2 pr-3 text-left transition-colors hover:border-line-2"
    >
      <span
        className="flex size-10 shrink-0 items-center justify-center rounded-[11px] bg-person font-mono text-[10px] font-medium text-person-on"
        style={personColorStyle(colorFromSeed(extension))}
      >
        {extension}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-medium text-ink">{attachment.name}</span>
        <span className="block font-mono text-[11px] text-ink-3">{formatBytes(attachment.size)}</span>
      </span>
      <IconDownload size={17} className="shrink-0 text-ink-3" />
    </button>
  );
}

function ImageViewer({ attachment, onClose }: { attachment: Attachment | null; onClose: () => void }) {
  return (
    <DialogPrimitive.Root open={attachment !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[#12110e]/90 data-[state=open]:animate-fade-in" />
        <DialogPrimitive.Content
          className="fixed inset-0 z-50 flex flex-col outline-none data-[state=open]:animate-fade-in"
          aria-describedby={undefined}
        >
          {attachment ? <ViewerBody attachment={attachment} /> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

function ViewerBody({ attachment }: { attachment: Attachment }) {
  const { url } = useAttachmentUrl(attachment.path);
  return (
    <>
      <div className="flex items-center gap-3 px-4 py-3 text-[#f3eee4]">
        <DialogPrimitive.Title className="min-w-0 flex-1 truncate text-sm font-medium">{attachment.name}</DialogPrimitive.Title>
        <Button variant="ghost" size="sm" className="text-[#f3eee4] hover:bg-white/10 hover:text-white" onClick={() => void download(attachment)}>
          <IconDownload size={16} />
          Download
        </Button>
        <DialogPrimitive.Close asChild>
          <Button variant="ghost" size="icon-sm" className="text-[#f3eee4] hover:bg-white/10 hover:text-white" aria-label="Close">
            <IconClose />
          </Button>
        </DialogPrimitive.Close>
      </div>
      <div className="flex min-h-0 flex-1 items-center justify-center p-4 pt-0">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={attachment.name} className="max-h-full max-w-full rounded-xl object-contain" />
        ) : null}
      </div>
    </>
  );
}

export function UploadTray({
  items,
  onRemove,
  onRetry,
}: {
  items: Array<{ id: string; file: File; status: "uploading" | "ready" | "failed"; previewUrl: string | null; error?: string }>;
  onRemove: (id: string) => void;
  onRetry: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="flex gap-2 overflow-x-auto px-3 pt-3" aria-label="Attachments">
      {items.map((item) => (
        <div
          key={item.id}
          className={cn(
            "group relative flex h-16 shrink-0 items-center overflow-hidden rounded-2xl border bg-surface-2",
            item.status === "failed" ? "border-danger" : "border-line",
            item.previewUrl ? "w-16" : "max-w-[220px] gap-2.5 pl-2 pr-8",
          )}
          title={item.error ?? item.file.name}
        >
          {item.previewUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.previewUrl} alt="" className="size-full object-cover" />
          ) : (
            <>
              <span
                className="flex size-10 shrink-0 items-center justify-center rounded-[11px] bg-person font-mono text-[10px] text-person-on"
                style={personColorStyle(colorFromSeed(extensionOf(item.file.name)))}
              >
                {extensionOf(item.file.name)}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium">{item.file.name}</span>
                <span className="block font-mono text-[10.5px] text-ink-3">
                  {item.status === "failed" ? "Failed" : formatBytes(item.file.size)}
                </span>
              </span>
            </>
          )}

          {item.status === "uploading" ? (
            <span className="absolute inset-x-2 bottom-1.5 h-1 overflow-hidden rounded-full bg-[color-mix(in_srgb,var(--ink)_15%,transparent)]">
              <span className="block h-full w-1/3 animate-[upload-slide_1s_ease-in-out_infinite] rounded-full bg-ink" />
            </span>
          ) : null}

          {item.status === "failed" ? (
            <button
              type="button"
              onClick={() => onRetry(item.id)}
              className="absolute inset-0 flex items-center justify-center bg-danger-tint/90 text-[12px] font-medium text-danger"
            >
              Retry
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => onRemove(item.id)}
            className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-inverse text-inverse-ink opacity-90 transition-opacity hover:opacity-100"
            aria-label={`Remove ${item.file.name}`}
          >
            <IconClose size={11} />
          </button>
        </div>
      ))}
    </div>
  );
}
