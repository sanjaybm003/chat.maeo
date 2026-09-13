import { env } from "@/lib/env";

export const AVATAR_BUCKET = "avatars";
export const ATTACHMENT_BUCKET = "attachments";

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;

function encodePath(path: string) {
  return path.split("/").map(encodeURIComponent).join("/");
}

export function avatarUrl(path: string) {
  return `${env.supabaseUrl}/storage/v1/object/public/${AVATAR_BUCKET}/${encodePath(path)}`;
}

/** Keeps the original extension, drops anything that could upset a URL. */
export function safeFileName(name: string) {
  const dot = name.lastIndexOf(".");
  const base = (dot > 0 ? name.slice(0, dot) : name)
    .normalize("NFKD")
    .replace(/[^\w.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  const ext = dot > 0 ? name.slice(dot + 1).replace(/[^\w]/g, "").slice(0, 10) : "";
  return `${base || "file"}${ext ? `.${ext.toLowerCase()}` : ""}`;
}

export function isImageType(type: string) {
  return /^image\/(png|jpe?g|gif|webp|avif)$/i.test(type);
}
