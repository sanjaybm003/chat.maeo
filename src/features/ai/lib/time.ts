/**
 * The asker's clock for agent replies, so "today", "this morning" and message
 * times mean what they mean to the person asking.
 */

/** A time zone the platform knows, or UTC. */
export function validTimeZone(value: string | null | undefined): string {
  if (!value) return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return value;
  } catch {
    return "UTC";
  }
}

function partsOf(date: Date, timeZone: string) {
  const parts: Record<string, string> = {};
  const format = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  for (const part of format.formatToParts(date)) parts[part.type] = part.value;
  return parts;
}

/** The asker's calendar date, as a local midnight for date arithmetic. */
export function localToday(timeZone: string, now = new Date()) {
  const parts = partsOf(now, timeZone);
  return new Date(Number(parts.year), Number(parts.month) - 1, Number(parts.day));
}

/** "2026-09-15 09:05" in that time zone. */
export function localStamp(iso: string, timeZone: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 16).replace("T", " ");
  const parts = partsOf(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

/** "Tuesday 15 September 2026, 09:05" in that time zone. */
export function describeNow(timeZone: string, now = new Date()) {
  const day = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(now);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
  return `${day}, ${time}`;
}
