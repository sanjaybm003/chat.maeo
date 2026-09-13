import { describe, expect, it } from "vitest";

import { fillDays, localDayKey, niceCeiling } from "./usage";

describe("fillDays", () => {
  it("returns one entry per day ending today, filling gaps with zeros", () => {
    const now = new Date(2026, 8, 13, 15, 30);
    const series = fillDays(
      [
        { day: "2026-09-11", credits: 40, runs: 2 },
        { day: "2026-09-13", credits: 7, runs: 1 },
        { day: "2026-08-01", credits: 999, runs: 9 },
      ],
      4,
      now,
    );
    expect(series).toEqual([
      { day: "2026-09-10", credits: 0, runs: 0 },
      { day: "2026-09-11", credits: 40, runs: 2 },
      { day: "2026-09-12", credits: 0, runs: 0 },
      { day: "2026-09-13", credits: 7, runs: 1 },
    ]);
  });

  it("crosses month boundaries", () => {
    expect(fillDays([], 3, new Date(2026, 9, 1)).map((day) => day.day)).toEqual(["2026-09-29", "2026-09-30", "2026-10-01"]);
    expect(localDayKey(new Date(2026, 0, 5))).toBe("2026-01-05");
  });
});

describe("niceCeiling", () => {
  it("rounds up to 1, 2 or 5 times a power of ten", () => {
    expect(niceCeiling(0)).toBe(10);
    expect(niceCeiling(7)).toBe(10);
    expect(niceCeiling(12)).toBe(20);
    expect(niceCeiling(180)).toBe(200);
    expect(niceCeiling(201)).toBe(500);
    expect(niceCeiling(5000)).toBe(5000);
    expect(niceCeiling(5001)).toBe(10000);
  });
});
