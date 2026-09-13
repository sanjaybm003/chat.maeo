import { describe, expect, it } from "vitest";

import { creditsForUsage, estimateReservation, estimateTokens, formatCredits, typicalReplyCredits } from "./credits";
import { AI_MODELS, findModel, recommendModel } from "./models";

const opus = findModel("claude-opus-5")!;
const luna = findModel("gpt-5.6-luna")!;

describe("creditsForUsage", () => {
  it("prices tokens at list price, 1 credit per $0.001", () => {
    // 10k input × $5/M = $0.05; 2k output × $25/M = $0.05 → $0.10 → 100 credits
    expect(creditsForUsage(opus, { inputTokens: 10_000, outputTokens: 2_000 })).toBe(100);
  });

  it("discounts cache reads, surcharges cache writes and bills web searches", () => {
    const base = creditsForUsage(opus, { inputTokens: 100_000, outputTokens: 0 });
    expect(creditsForUsage(opus, { inputTokens: 0, cacheReadTokens: 100_000, outputTokens: 0 })).toBe(Math.ceil(base * 0.1));
    expect(creditsForUsage(opus, { inputTokens: 0, cacheWriteTokens: 100_000, outputTokens: 0 })).toBe(Math.ceil(base * 1.25));
    expect(creditsForUsage(opus, { inputTokens: 0, outputTokens: 0, webSearches: 3 })).toBe(30);
  });

  it("charges at least one credit for any real usage and nothing for none", () => {
    expect(creditsForUsage(luna, { inputTokens: 10, outputTokens: 5 })).toBe(1);
    expect(creditsForUsage(luna, { inputTokens: 0, outputTokens: 0 })).toBe(0);
    expect(creditsForUsage(luna, { inputTokens: -50, outputTokens: Number.NaN })).toBe(0);
  });
});

describe("estimateReservation", () => {
  it("always covers the actual cost of a call within the output limit", () => {
    const reserved = estimateReservation(opus, { inputTokens: 5000, maxOutputTokens: 12_000, webSearches: 3 });
    const worstActual = creditsForUsage(opus, { inputTokens: 5000, outputTokens: 12_000, webSearches: 3 });
    expect(reserved).toBeGreaterThanOrEqual(worstActual);
  });
});

describe("estimates and formatting", () => {
  it("overestimates tokens for typical English", () => {
    const sentence = "Can you summarize what we decided about the launch plan yesterday?";
    expect(estimateTokens(sentence)).toBeGreaterThanOrEqual(15);
  });

  it("ranks models by typical reply price", () => {
    expect(typicalReplyCredits(opus)).toBeGreaterThan(typicalReplyCredits(luna));
  });

  it("formats balances for display", () => {
    expect(formatCredits(9412)).toBe("9,412");
    expect(formatCredits(1_250_000)).toBe("1.3M");
  });
});

describe("catalog", () => {
  it("has unique ids and sane prices", () => {
    expect(new Set(AI_MODELS.map((model) => model.id)).size).toBe(AI_MODELS.length);
    for (const model of AI_MODELS) {
      expect(model.outputPrice).toBeGreaterThanOrEqual(model.inputPrice);
      expect(model.id).toMatch(/^[a-z0-9][a-z0-9._-]{1,79}$/);
    }
  });

  it("recommends the first available model in a tier, falling back to any", () => {
    const available = AI_MODELS.filter((model) => model.provider === "google");
    expect(recommendModel("fast", available)?.id).toBe("gemini-3.5-flash-lite");
    expect(recommendModel("deep", [luna])?.id).toBe("gpt-5.6-luna");
    expect(recommendModel("deep", [])).toBeNull();
  });
});
