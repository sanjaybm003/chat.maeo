import { describe, expect, it } from "vitest";

import { normalizeEmailFrom } from "./email-from";

describe("normalizeEmailFrom", () => {
  it("strips quotes that a hosting dashboard kept literally", () => {
    expect(normalizeEmailFrom('"maeosan <team@example.com>"')).toBe("maeosan <team@example.com>");
    expect(normalizeEmailFrom("'team@example.com'")).toBe("team@example.com");
    expect(normalizeEmailFrom('  "maeosan <team@example.com>"  ')).toBe("maeosan <team@example.com>");
  });

  it("leaves clean values alone", () => {
    expect(normalizeEmailFrom("maeosan <team@example.com>")).toBe("maeosan <team@example.com>");
    expect(normalizeEmailFrom('Team "Alpha" <team@example.com>')).toBe('Team "Alpha" <team@example.com>');
  });

  it("treats empty values as unset", () => {
    expect(normalizeEmailFrom("")).toBeNull();
    expect(normalizeEmailFrom('""')).toBeNull();
    expect(normalizeEmailFrom(undefined)).toBeNull();
  });
});
