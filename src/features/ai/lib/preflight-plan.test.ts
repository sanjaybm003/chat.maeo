import { describe, expect, it } from "vitest";

import { contextBudget } from "./context-select";
import { planPreflight, searchQueryFrom, wantsWebResearch } from "./preflight-plan";

const options = { tools: ["web", "tasks"], searchAvailable: true, nativeWebSearch: false };

describe("wantsWebResearch", () => {
  it("searches first only for plain questions about the outside world", () => {
    expect(wantsWebResearch("@scout what's the latest version of Next.js?")).toBe(true);
    expect(wantsWebResearch("What is the current price of gold in India?")).toBe(true);
    expect(wantsWebResearch("What did we decide about pricing today?")).toBe(false);
    expect(wantsWebResearch("Draft a post about our latest release")).toBe(false);
    expect(wantsWebResearch("thanks!")).toBe(false);
  });
});

describe("planPreflight", () => {
  it("plans a search, reads shared links instead of searching, and looks up tasks by number", () => {
    expect(planPreflight("@scout what's the latest Next.js release?", options)).toEqual({
      webQuery: "what's the latest Next.js release?",
      links: [],
      taskNumbers: [],
    });
    expect(planPreflight("Summarize https://example.com/post?ref=1. Latest news?", options)).toEqual({
      webQuery: null,
      links: ["https://example.com/post?ref=1"],
      taskNumbers: [],
    });
    expect(planPreflight("Status of T-12 and t-7? And T-12 again", options).taskNumbers).toEqual([12, 7]);
  });

  it("stays within the agent's tools and the model's own search", () => {
    expect(planPreflight("see https://example.com what's the latest?", { ...options, tools: ["tasks"] })).toEqual({
      webQuery: null,
      links: [],
      taskNumbers: [],
    });
    expect(planPreflight("What is the latest Next.js release?", { ...options, nativeWebSearch: true }).webQuery).toBeNull();
    expect(planPreflight("What is the latest Next.js release?", { ...options, searchAvailable: false }).webQuery).toBeNull();
    expect(searchQueryFrom("@dev look at ```code``` and https://x.y/z now")).toBe("look at and now");
  });
});

describe("contextBudget", () => {
  it("reads less for quick questions and more for hard ones", () => {
    expect(contextBudget(0.2)).toEqual({ maxChars: 12_000, keepRecent: 8 });
    expect(contextBudget(0.5)).toEqual({ maxChars: 24_000, keepRecent: 12 });
    expect(contextBudget(0.9)).toEqual({ maxChars: 40_000, keepRecent: 16 });
  });
});
