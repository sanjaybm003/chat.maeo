import { describe, expect, it } from "vitest";

import { describeNow, localStamp, localToday, validTimeZone } from "./time";

describe("the asker's clock", () => {
  it("accepts real time zones and falls back to UTC", () => {
    expect(validTimeZone("Asia/Kolkata")).toBe("Asia/Kolkata");
    expect(validTimeZone("Mars/Olympus")).toBe("UTC");
    expect(validTimeZone(undefined)).toBe("UTC");
  });

  it("shows times and dates as they are where the asker is", () => {
    expect(localStamp("2026-09-14T18:30:00.000+00:00", "Asia/Kolkata")).toBe("2026-09-15 00:00");
    expect(localStamp("2026-09-14T18:30:00.000+00:00", "UTC")).toBe("2026-09-14 18:30");
    const today = localToday("Asia/Kolkata", new Date("2026-09-14T20:00:00Z"));
    expect([today.getFullYear(), today.getMonth() + 1, today.getDate()]).toEqual([2026, 9, 15]);
    expect(describeNow("America/New_York", new Date("2026-09-15T13:05:00Z"))).toMatch(/Tuesday,? 15 September 2026, 09:05/);
  });
});
