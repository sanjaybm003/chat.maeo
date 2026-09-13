export interface DayUsage {
  day: string;
  credits: number;
  runs: number;
}

const pad = (value: number) => String(value).padStart(2, "0");

/** YYYY-MM-DD in the viewer's own calendar, matching the time zone sent to the usage query. */
export function localDayKey(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** One entry per calendar day ending today, with zeros where nothing ran. */
export function fillDays(days: readonly DayUsage[], count: number, now = new Date()): DayUsage[] {
  const byDay = new Map(days.map((day) => [day.day, day]));
  const series: DayUsage[] = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const key = localDayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset));
    const hit = byDay.get(key);
    series.push({ day: key, credits: hit?.credits ?? 0, runs: hit?.runs ?? 0 });
  }
  return series;
}

/** The smallest 1, 2 or 5 × 10ⁿ at or above the value, so axis ticks land on round numbers. */
export function niceCeiling(value: number) {
  if (!Number.isFinite(value) || value <= 0) return 10;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const fraction = value / magnitude;
  const step = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return Math.max(10, step * magnitude);
}

export function dayLabel(key: string, style: "short" | "long" = "short") {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day).toLocaleDateString(
    undefined,
    style === "short" ? { month: "short", day: "numeric" } : { weekday: "short", month: "short", day: "numeric" },
  );
}
