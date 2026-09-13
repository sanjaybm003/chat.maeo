import type { PresenceStatus } from "@/types/domain";

export interface ActivityMonitor {
  readonly status: PresenceStatus;
  dispose: () => void;
}

const INPUT_EVENTS = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart", "focus"] as const;

/**
 * Reports "away" after a stretch without any interaction and "active" on the
 * next one. A hidden tab alone doesn't make someone away: people keep chat in
 * a background tab while they work.
 */
export function watchActivity(
  onChange: (status: PresenceStatus) => void,
  { idleAfterMs = 10 * 60_000, inputThrottleMs = 1000 } = {},
): ActivityMonitor {
  let status: PresenceStatus = "active";
  let lastInputAt = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const set = (next: PresenceStatus) => {
    if (next === status) return;
    status = next;
    onChange(next);
  };

  const arm = () => {
    clearTimeout(timer);
    timer = setTimeout(() => set("away"), idleAfterMs);
  };

  const onInput = () => {
    const now = Date.now();
    if (now - lastInputAt < inputThrottleMs) return;
    lastInputAt = now;
    set("active");
    arm();
  };

  for (const event of INPUT_EVENTS) window.addEventListener(event, onInput, { passive: true });
  document.addEventListener("visibilitychange", onInput);
  arm();

  return {
    get status() {
      return status;
    },
    dispose() {
      clearTimeout(timer);
      for (const event of INPUT_EVENTS) window.removeEventListener(event, onInput);
      document.removeEventListener("visibilitychange", onInput);
    },
  };
}
