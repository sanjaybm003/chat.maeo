import { describe, expect, it } from "vitest";

import { AI_MODELS, findModel } from "./models";
import { fallbackModel, routeModel, scoreComplexity, tierForComplexity } from "./router";

const base = { style: "balanced", mode: "auto", agentModel: "claude-sonnet-5", available: AI_MODELS } as const;
const pick = (...ids: string[]) => ids.map((id) => findModel(id)!);

describe("scoreComplexity", () => {
  it("keeps greetings light and reasoning-heavy requests deep", () => {
    expect(tierForComplexity(scoreComplexity("thanks!", "assistant", "balanced"))).toBe("fast");
    expect(
      tierForComplexity(scoreComplexity("Compare the three pricing options and analyze the trade-offs for our churn forecast", "analysis", "balanced")),
    ).toBe("deep");
    expect(tierForComplexity(scoreComplexity("Can you draft a note to the design team about Friday's review?", "writing", "balanced"))).toBe(
      "balanced",
    );
  });

  it("stays within 0..1 and responds to style and code", () => {
    const plain = scoreComplexity("why is this failing", "engineering", "balanced");
    expect(scoreComplexity("why is this failing\n```ts\nthrow new Error()\n```", "engineering", "balanced")).toBeGreaterThan(plain);
    expect(scoreComplexity("why is this failing", "engineering", "concise")).toBeLessThan(plain);
    expect(scoreComplexity("analyze compare evaluate ".repeat(80), "analysis", "detailed")).toBeLessThanOrEqual(1);
  });
});

describe("fallbackModel", () => {
  it("stands in with the same tier first, then the nearest, never repeating a model", () => {
    const haiku = findModel("claude-haiku-4-5")!;
    const available = pick("claude-haiku-4-5", "claude-sonnet-5", "openai.gpt-oss-20b", "deepseek.v3.2");
    expect(fallbackModel(haiku, "assistant", available, new Set(["claude-haiku-4-5"]))?.id).toBe("openai.gpt-oss-20b");
    expect(fallbackModel(haiku, "assistant", available, new Set(["claude-haiku-4-5", "openai.gpt-oss-20b", "claude-sonnet-5"]))?.id).toBe(
      "deepseek.v3.2",
    );
    expect(fallbackModel(haiku, "assistant", pick("claude-haiku-4-5"), new Set(["claude-haiku-4-5"]))).toBeNull();
  });
});

describe("routeModel", () => {
  it("routes by complexity within the specialty's preferred providers", () => {
    expect(routeModel({ ...base, text: "thanks!", specialty: "assistant" })?.model.id).toBe("claude-haiku-4-5");
    const deep = routeModel({
      ...base,
      text: "Compare the three pricing options and analyze the trade-offs for our churn forecast",
      specialty: "analysis",
    });
    expect(deep).toMatchObject({ mode: "auto", tier: "deep" });
    expect(deep?.model.id).toBe("claude-opus-5");
    expect(routeModel({ ...base, text: "Draft a warm welcome note for Priya", specialty: "writing", available: pick("gpt-5.6-terra", "claude-sonnet-5") })?.model.id).toBe(
      "gpt-5.6-terra",
    );
  });

  it("honours a model picked for the message, then the agent's own model", () => {
    expect(routeModel({ ...base, text: "hi", specialty: "assistant", override: "gpt-5.6-sol" })).toMatchObject({ mode: "override" });
    expect(routeModel({ ...base, text: "hi", specialty: "assistant", override: "auto", mode: "fixed", agentModel: "gemini-3.8-flash" })).toMatchObject({
      mode: "fixed",
      model: { id: "gemini-3.8-flash" },
    });
  });

  it("falls back to auto when a pinned or picked model isn't available", () => {
    const available = AI_MODELS.filter((model) => model.provider !== "google");
    const decision = routeModel({ ...base, text: "hi", specialty: "assistant", mode: "fixed", agentModel: "gemini-3.8-flash", override: "gemini-3.1-pro-preview", available });
    expect(decision?.mode).toBe("auto");
    expect(decision?.reason).toMatch(/^Gemini 3\.8 Flash is unavailable/);
  });

  it("steps down a tier at a time to stretch a thin wallet", () => {
    const text = "Compare the three pricing options and analyze the trade-offs for our churn forecast";
    const decision = routeModel({ ...base, text, specialty: "analysis", balance: 100 });
    expect(decision?.model.id).toBe("claude-haiku-4-5");
    expect(decision?.reason).toMatch(/saving credits/);
    expect(routeModel({ ...base, text, specialty: "analysis", balance: 1_000_000 })?.model.id).toBe("claude-opus-5");
  });

  it("prefers web-capable models for current facts when the agent can search", () => {
    const available = pick("gpt-5.6-terra", "claude-sonnet-5");
    const text = "Draft a post about the latest pricing news this week";
    expect(routeModel({ ...base, text, specialty: "writing", available })?.model.id).toBe("gpt-5.6-terra");
    const withWeb = routeModel({ ...base, text, specialty: "writing", available, wantsWeb: true });
    expect(withWeb?.model.id).toBe("claude-sonnet-5");
    expect(withWeb?.reason).toMatch(/web search/);
  });

  it("uses the nearest tier when a tier has no model, and nothing when no models exist", () => {
    expect(routeModel({ ...base, text: "thanks!", specialty: "assistant", available: pick("claude-opus-5") })?.model.id).toBe("claude-opus-5");
    expect(routeModel({ ...base, text: "thanks!", specialty: "assistant", available: [] })).toBeNull();
  });
});
