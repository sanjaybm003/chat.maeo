"use client";

import { useEffect, useState } from "react";

import { cachedAttachmentUrl, getAttachmentUrl } from "@/features/workspace/api/attachments";

export function useAttachmentUrl(path: string) {
  const [resolved, setResolved] = useState<{ path: string; url: string | null } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void getAttachmentUrl(path).then((url) => {
      if (!cancelled) setResolved({ path, url });
    });
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (resolved?.path === path) return { url: resolved.url, failed: resolved.url === null };
  return { url: cachedAttachmentUrl(path), failed: false };
}
