"use client";

import { useHydrated } from "@/hooks/use-hydrated";
import { formatClock, formatDayDivider, formatFullTimestamp, formatListTimestamp, formatShortDate } from "@/lib/dates";

const FORMATS = {
  clock: formatClock,
  list: formatListTimestamp,
  day: formatDayDivider,
  short: formatShortDate,
  full: formatFullTimestamp,
} as const;

interface LocalTimeProps {
  iso: string;
  format?: keyof typeof FORMATS;
  className?: string;
  withTitle?: boolean;
}

/** Formats in the viewer's time zone, only once the browser has taken over. */
export function LocalTime({ iso, format = "clock", className, withTitle }: LocalTimeProps) {
  const hydrated = useHydrated();
  return (
    <time
      dateTime={iso}
      className={className}
      title={hydrated && withTitle ? formatFullTimestamp(iso) : undefined}
      suppressHydrationWarning
    >
      {hydrated ? FORMATS[format](iso) : ""}
    </time>
  );
}
