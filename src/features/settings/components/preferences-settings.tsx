"use client";

import { useReducer } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { playChime } from "@/features/workspace/notifications/notifier";
import { disablePush, enablePush, isPushSupported } from "@/features/notifications/push-client";
import { useHydrated } from "@/hooks/use-hydrated";
import { logger } from "@/lib/logger";
import { usePreferences, type ChatPattern, type ThemePreference } from "@/lib/preferences";
import { cn } from "@/lib/utils";

import { SettingRow, SettingsSection } from "./settings-chrome";

const THEMES: Array<{ value: ThemePreference; label: string }> = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "Match system" },
];

const PATTERNS: Array<{ value: ChatPattern; label: string }> = [
  { value: "dots", label: "Dots" },
  { value: "grid", label: "Grid" },
  { value: "plus", label: "Plus" },
  { value: "zigzag", label: "Zigzag" },
  { value: "plain", label: "Plain" },
];

const PALETTES = {
  light: { paper: "#f4f0e8", surface: "#ffffff", ink: "#191713", line: "#e5dfd2", tint: "#dfe5fd" },
  dark: { paper: "#12110e", surface: "#1a1814", ink: "#f3eee4", line: "#2b2823", tint: "#1b2349" },
};

function ThemePreview({ mode }: { mode: "light" | "dark" }) {
  const p = PALETTES[mode];
  return (
    <g>
      <rect width="160" height="96" fill={p.paper} />
      <rect width="46" height="96" fill={p.surface} />
      <rect x="46" width="1" height="96" fill={p.line} />
      <circle cx="12" cy="14" r="5" fill="#f2542d" />
      <rect x="21" y="11" width="18" height="5" rx="2.5" fill={p.line} />
      {[30, 46, 62].map((y) => (
        <g key={y}>
          <circle cx="12" cy={y} r="5" fill={p.line} />
          <rect x="21" y={y - 3} width="18" height="5" rx="2.5" fill={p.line} />
        </g>
      ))}
      <rect x="56" y="16" width="60" height="14" rx="7" fill={p.surface} stroke={p.line} />
      <rect x="84" y="36" width="64" height="14" rx="7" fill={p.tint} />
      <rect x="56" y="56" width="44" height="14" rx="7" fill={p.surface} stroke={p.line} />
      <rect x="56" y="78" width="94" height="12" rx="6" fill={p.surface} stroke={p.line} />
      <circle cx="144" cy="84" r="3.5" fill="#3355f0" />
    </g>
  );
}

export function PreferencesSettings() {
  const [preferences, updatePreferences] = usePreferences();
  const hydrated = useHydrated();
  const [, rerender] = useReducer((count: number) => count + 1, 0);

  const supported = hydrated && typeof Notification !== "undefined";
  const permission = supported ? Notification.permission : "default";

  async function setDesktopNotifications(enabled: boolean) {
    if (!enabled) {
      updatePreferences({ desktopNotifications: false });
      void disablePush().catch(() => undefined);
      return;
    }
    if (!supported) {
      toast.error("This browser doesn't support notifications.");
      return;
    }
    const result = permission === "granted" ? "granted" : await Notification.requestPermission();
    rerender();
    if (result === "granted") {
      updatePreferences({ desktopNotifications: true });
      if (isPushSupported()) void enablePush().catch((error) => logger.warn("web push subscription failed", { error }));
      new Notification("Notifications are on", { body: "We'll only ping you when maeosan isn't in front of you.", icon: "/icon.svg" });
    } else {
      toast.error("Notifications are blocked. Allow them in your browser's site settings.");
    }
  }

  return (
    <>
      <SettingsSection title="Theme" description="Light is home. Dark is there for late nights. Saved on this device.">
        <div role="radiogroup" aria-label="Theme" className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {THEMES.map((theme) => {
            const active = preferences.theme === theme.value;
            return (
              <button
                key={theme.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => updatePreferences({ theme: theme.value })}
                className={cn(
                  "overflow-hidden rounded-[18px] border-2 bg-surface text-left transition-colors",
                  active ? "border-ink" : "border-line hover:border-line-2",
                )}
              >
                <svg viewBox="0 0 160 96" className="block w-full" aria-hidden="true">
                  {theme.value === "system" ? (
                    <>
                      <ThemePreview mode="light" />
                      <svg x="80" width="80" height="96" viewBox="80 0 80 96">
                        <ThemePreview mode="dark" />
                      </svg>
                    </>
                  ) : (
                    <ThemePreview mode={theme.value} />
                  )}
                </svg>
                <span className="flex items-center justify-between border-t border-line px-3 py-2.5 text-[13.5px] font-medium">
                  {theme.label}
                  <span className={cn("size-3 rounded-full border-2", active ? "border-ink bg-ink" : "border-line-2")} />
                </span>
              </button>
            );
          })}
        </div>
      </SettingsSection>

      <SettingsSection title="Chat backdrop" description="The pattern behind your messages. Pick what feels calm.">
        <div role="radiogroup" aria-label="Chat backdrop" className="grid grid-cols-3 gap-3 sm:grid-cols-5">
          {PATTERNS.map((pattern) => {
            const active = preferences.pattern === pattern.value;
            return (
              <button
                key={pattern.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => updatePreferences({ pattern: pattern.value })}
                className={cn(
                  "rounded-[18px] border-2 p-1.5 transition-colors",
                  active ? "border-ink" : "border-line hover:border-line-2",
                )}
              >
                <span className="backdrop-pattern block h-16 overflow-hidden rounded-[12px] bg-paper" data-pattern={pattern.value} />
                <span className="block pb-0.5 pt-2 text-center text-[12.5px] font-medium">{pattern.label}</span>
              </button>
            );
          })}
        </div>
      </SettingsSection>

      <SettingsSection title="Messages">
        <SettingRow
          title="Enter sends"
          description="Shift + Enter for a new line. Turn off to send with Ctrl/⌘ + Enter instead."
          control={<Switch checked={preferences.enterToSend} onCheckedChange={(checked) => updatePreferences({ enterToSend: checked })} />}
        />
      </SettingsSection>

      <SettingsSection title="Notifications" description="Muted chats never make a sound, whatever you choose here.">
        <SettingRow
          title="Sound"
          description="A soft two-note chime for new messages."
          control={
            <div className="flex items-center gap-3">
              <Button variant="ghost" size="sm" onClick={playChime}>
                Test
              </Button>
              <Switch checked={preferences.sound} onCheckedChange={(checked) => updatePreferences({ sound: checked })} />
            </div>
          }
        />
        <SettingRow
          title="Desktop notifications"
          description={
            permission === "denied"
              ? "Blocked by your browser. Allow notifications for this site to turn them on."
              : "Pop-ups for new messages while maeosan is in the background."
          }
          control={
            <Switch
              checked={preferences.desktopNotifications && permission === "granted"}
              onCheckedChange={(checked) => void setDesktopNotifications(checked)}
              disabled={permission === "denied"}
            />
          }
        />
      </SettingsSection>
    </>
  );
}
