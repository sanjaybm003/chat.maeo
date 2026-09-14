/**
 * Calendar dates for tasks, as YYYY-MM-DD strings. Due dates are days, not
 * moments, so they never shift with time zones once chosen.
 */

const pad = (value: number) => String(value).padStart(2, "0");

export const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
export const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** The local calendar date of a moment. */
export const isoDate = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** The next date after today with this weekday (0 is Sunday); today itself counts as a week away. */
export function nextWeekday(today: Date, weekday: number) {
  return addDays(today, (weekday - today.getDay() + 7) % 7 || 7);
}

/** A valid calendar date, or null for 31 February and friends. */
export function dateFromParts(year: number, monthIndex: number, day: number): Date | null {
  const date = new Date(year, monthIndex, day);
  return date.getFullYear() === year && date.getMonth() === monthIndex && date.getDate() === day ? date : null;
}

function utcDay(iso: string) {
  return Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
}

/** Whole calendar days from one date to another; negative when `to` is earlier. */
export const daysBetween = (from: string, to: string) => Math.round((utcDay(to) - utcDay(from)) / 86_400_000);

export function weekdayOf(iso: string) {
  return new Date(utcDay(iso)).getUTCDay();
}

/** "3 Oct", or "3 Oct 2027" outside the current year. */
export function shortDate(iso: string, todayIso: string) {
  const label = `${Number(iso.slice(8, 10))} ${MONTH_NAMES[Number(iso.slice(5, 7)) - 1]}`;
  return iso.slice(0, 4) === todayIso.slice(0, 4) ? label : `${label} ${iso.slice(0, 4)}`;
}
