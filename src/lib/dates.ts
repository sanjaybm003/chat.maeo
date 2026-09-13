import {
  differenceInCalendarDays,
  differenceInMinutes,
  format,
  formatDistanceToNowStrict,
  isSameDay,
  isThisYear,
  isToday,
  isYesterday,
} from "date-fns";

export function formatClock(iso: string) {
  return format(new Date(iso), "h:mm a");
}

/** Sidebar timestamps: 4:12 PM · Yesterday · Tue · Sep 3 · Sep 3, 2025 */
export function formatListTimestamp(iso: string) {
  const date = new Date(iso);
  if (isToday(date)) return format(date, "h:mm a");
  if (isYesterday(date)) return "Yesterday";
  if (differenceInCalendarDays(new Date(), date) < 7) return format(date, "EEE");
  if (isThisYear(date)) return format(date, "MMM d");
  return format(date, "MMM d, yyyy");
}

export function formatDayDivider(iso: string) {
  const date = new Date(iso);
  if (isToday(date)) return "Today";
  if (isYesterday(date)) return "Yesterday";
  if (isThisYear(date)) return format(date, "EEEE, MMMM d");
  return format(date, "EEEE, MMMM d, yyyy");
}

export function formatFullTimestamp(iso: string) {
  return format(new Date(iso), "EEEE, MMMM d, yyyy 'at' h:mm a");
}

export function formatShortDate(iso: string) {
  const date = new Date(iso);
  return isThisYear(date) ? format(date, "MMM d") : format(date, "MMM d, yyyy");
}

export function sameDay(a: string, b: string) {
  return isSameDay(new Date(a), new Date(b));
}

/** "5 minutes ago", "3 days ago" */
export function formatLastSeen(iso: string) {
  return formatDistanceToNowStrict(new Date(iso), { addSuffix: true });
}

export function minutesApart(a: string, b: string) {
  return Math.abs(differenceInMinutes(new Date(a), new Date(b)));
}
