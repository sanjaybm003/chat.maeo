import { ATTACHMENT_BUCKET, AVATAR_BUCKET, isImageType, MAX_ATTACHMENT_BYTES, safeFileName } from "@/lib/storage";
import { formatBytes } from "@/lib/utils";
import type { Attachment } from "@/types/domain";

import { db } from "./client";

const SIGNED_URL_TTL_SECONDS = 60 * 60;
const urlCache = new Map<string, { url: string; expiresAt: number }>();
const waiting = new Map<string, Array<(url: string | null) => void>>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

/** Lets freshly uploaded images render from memory instead of a round trip. */
export function primeAttachmentUrl(path: string, url: string) {
  urlCache.set(path, { url, expiresAt: Number.POSITIVE_INFINITY });
}

export function cachedAttachmentUrl(path: string) {
  const hit = urlCache.get(path);
  return hit && hit.expiresAt > Date.now() ? hit.url : null;
}

/** Batches every request made in the same tick into one createSignedUrls call. */
export function getAttachmentUrl(path: string): Promise<string | null> {
  const cached = cachedAttachmentUrl(path);
  if (cached) return Promise.resolve(cached);

  return new Promise((resolve) => {
    waiting.set(path, [...(waiting.get(path) ?? []), resolve]);
    flushTimer ??= setTimeout(flush, 0);
  });
}

async function flush() {
  flushTimer = null;
  const batch = new Map(waiting);
  waiting.clear();
  const paths = [...batch.keys()];
  if (paths.length === 0) return;

  const { data, error } = await db().storage.from(ATTACHMENT_BUCKET).createSignedUrls(paths, SIGNED_URL_TTL_SECONDS);
  const expiresAt = Date.now() + (SIGNED_URL_TTL_SECONDS - 120) * 1000;

  for (const path of paths) {
    const entry = error ? undefined : data?.find((item) => item.path === path);
    const url = entry?.signedUrl ?? null;
    if (url) urlCache.set(path, { url, expiresAt });
    for (const resolve of batch.get(path) ?? []) resolve(url);
  }
}

export async function getAttachmentDownloadUrl(attachment: Attachment) {
  const { data, error } = await db()
    .storage.from(ATTACHMENT_BUCKET)
    .createSignedUrl(attachment.path, 60, { download: attachment.name });
  if (error) throw error;
  return data.signedUrl;
}

async function imageSize(file: File) {
  try {
    const bitmap = await createImageBitmap(file);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close();
    return size;
  } catch {
    return null;
  }
}

export async function uploadAttachment(conversationId: string, userId: string, file: File): Promise<Attachment> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error(`${file.name} is larger than ${formatBytes(MAX_ATTACHMENT_BYTES)}.`);
  }

  const path = `${conversationId}/${userId}/${crypto.randomUUID()}-${safeFileName(file.name)}`;
  const type = file.type || "application/octet-stream";
  const { error } = await db().storage.from(ATTACHMENT_BUCKET).upload(path, file, {
    contentType: type,
    cacheControl: "31536000",
    upsert: false,
  });
  if (error) throw error;

  const attachment: Attachment = { path, name: file.name.slice(0, 200), size: file.size, type };
  if (isImageType(type)) {
    const size = await imageSize(file);
    if (size) Object.assign(attachment, size);
    primeAttachmentUrl(path, URL.createObjectURL(file));
  }
  return attachment;
}

export async function removeUploadedAttachment(path: string) {
  await db().storage.from(ATTACHMENT_BUCKET).remove([path]);
}

/** Square-crops and downsizes to 320px WebP before uploading. */
export async function uploadAvatar(userId: string, file: File) {
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const canvas = document.createElement("canvas");
  canvas.width = 320;
  canvas.height = 320;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Your browser couldn't process that image.");
  context.drawImage(bitmap, (bitmap.width - side) / 2, (bitmap.height - side) / 2, side, side, 0, 0, 320, 320);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/webp", 0.9));
  if (!blob) throw new Error("Your browser couldn't process that image.");

  const path = `${userId}/${Date.now()}.webp`;
  const { error } = await db().storage.from(AVATAR_BUCKET).upload(path, blob, {
    contentType: "image/webp",
    cacheControl: "31536000",
    upsert: false,
  });
  if (error) throw error;
  return path;
}

export async function removeAvatarFile(path: string) {
  await db().storage.from(AVATAR_BUCKET).remove([path]);
}
