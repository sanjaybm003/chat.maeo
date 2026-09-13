import { describe, expect, it } from "vitest";

import { editDistance, fuzzyScore, rankItems } from "./fuzzy";

describe("fuzzyScore", () => {
  it("orders match tiers: exact > prefix > word start > substring > subsequence > typo", () => {
    const exact = fuzzyScore("sam", "sam");
    const prefix = fuzzyScore("sam", "samantha");
    const wordStart = fuzzyScore("oka", "sam okafor");
    const substring = fuzzyScore("kaf", "sam okafor");
    const subsequence = fuzzyScore("smok", "sam okafor");
    const typo = fuzzyScore("jordn", "jordan lee");

    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(wordStart);
    expect(wordStart).toBeGreaterThan(substring);
    expect(substring).toBeGreaterThan(subsequence);
    expect(subsequence).toBeGreaterThan(0);
    expect(typo).toBeGreaterThan(0);
  });

  it("ignores case and accents", () => {
    expect(fuzzyScore("rene", "René Dupont")).toBe(fuzzyScore("rene", "rene dupont"));
    expect(fuzzyScore("RENE", "rené dupont")).toBeGreaterThan(fuzzyScore("rene", "dupont rené"));
  });

  it("requires every word of a multi-word query", () => {
    expect(fuzzyScore("priya design", "priya nair product design")).toBeGreaterThan(0);
    expect(fuzzyScore("priya sales", "priya nair product design")).toBe(0);
  });

  it("rejects unrelated text", () => {
    expect(fuzzyScore("zzz", "priya nair")).toBe(0);
    expect(fuzzyScore("kenji", "priya nair")).toBe(0);
  });
});

describe("editDistance", () => {
  it("counts insertions, deletions, substitutions and adjacent swaps", () => {
    expect(editDistance("jordan", "jordan")).toBe(0);
    expect(editDistance("jordn", "jordan")).toBe(1);
    expect(editDistance("jrodan", "jordan")).toBe(1);
    expect(editDistance("kitten", "sitting")).toBe(3);
  });

  it("stops early past the bound", () => {
    expect(editDistance("abcdef", "uvwxyz", 1)).toBe(2);
  });
});

describe("rankItems", () => {
  const people = [
    { name: "Jordan Lee", email: "jordan@team.dev" },
    { name: "Priya Nair", email: "priya@team.dev" },
    { name: "Sam Okafor", email: "sam@team.dev" },
  ];

  it("filters and sorts by weighted relevance", () => {
    const ranked = rankItems(people, "sam", (person) => [
      [person.name, 1],
      [person.email, 0.7],
    ]);
    expect(ranked.map((person) => person.name)).toEqual(["Sam Okafor"]);
  });

  it("returns everything in original order for an empty query", () => {
    expect(rankItems(people, "  ", () => [])).toEqual(people);
  });
});
