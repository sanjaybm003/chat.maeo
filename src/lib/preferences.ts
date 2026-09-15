"use client";

import { useCallback, useSyncExternalStore } from "react";

import { PREFERENCES_STORAGE_KEY } from "@/lib/theme-script";

/** Per-device preferences. They describe this screen, not the account. */

export type ThemePreference = "light" | "dark" | "system";
export type ChatPattern = "dots" | "grid" | "plus" | "zigzag" | "plain";
export type TaskLayout = "list" | "board";

export interface Preferences {
  theme: ThemePreference;
  pattern: ChatPattern;
  sound: boolean;
  desktopNotifications: boolean;
  enterToSend: boolean;
  taskLayout: TaskLayout;
}

export const DEFAULT_PREFERENCES: Preferences = {
  theme: "light",
  pattern: "dots",
  sound: true,
  desktopNotifications: false,
  enterToSend: true,
  taskLayout: "list",
};

const CHANGE_EVENT = "maeosan:preferences-change";

let memoryRaw: string | null = null;
let cachedRaw: string | null | undefined;
let cachedValue: Preferences = DEFAULT_PREFERENCES;

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(PREFERENCES_STORAGE_KEY);
  } catch {
    return memoryRaw;
  }
}

function writeRaw(raw: string) {
  memoryRaw = raw;
  try {
    window.localStorage.setItem(PREFERENCES_STORAGE_KEY, raw);
  } catch {
    // Private mode or storage disabled: keep the in-memory copy for this tab.
  }
}

export function readPreferences(): Preferences {
  if (typeof window === "undefined") return DEFAULT_PREFERENCES;
  const raw = readRaw();
  if (raw === cachedRaw) return cachedValue;
  cachedRaw = raw;
  try {
    cachedValue = { ...DEFAULT_PREFERENCES, ...(raw ? (JSON.parse(raw) as Partial<Preferences>) : {}) };
  } catch {
    cachedValue = DEFAULT_PREFERENCES;
  }
  return cachedValue;
}

function subscribe(onChange: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === PREFERENCES_STORAGE_KEY) onChange();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

export function usePreferences() {
  const preferences = useSyncExternalStore(subscribe, readPreferences, () => DEFAULT_PREFERENCES);

  const update = useCallback((patch: Partial<Preferences>) => {
    writeRaw(JSON.stringify({ ...readPreferences(), ...patch }));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  }, []);

  return [preferences, update] as const;
}

export function resolveTheme(theme: ThemePreference): "light" | "dark" {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return theme;
}
