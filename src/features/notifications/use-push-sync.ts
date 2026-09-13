"use client";

import { useEffect } from "react";

import { logger } from "@/lib/logger";
import { usePreferences } from "@/lib/preferences";

import { enablePush, isPushSupported } from "./push-client";

/** Keeps this browser's push subscription current while notifications are on. */
export function usePushSync() {
  const [{ desktopNotifications }] = usePreferences();

  useEffect(() => {
    if (!desktopNotifications || !isPushSupported() || Notification.permission !== "granted") return;
    enablePush().catch((error) => logger.warn("web push subscription failed", { error }));
  }, [desktopNotifications]);
}
