import { describe, expect, it } from "vitest";

import { AI_MODELS, findModel } from "./models";
import { fallbackModel, routeModel, scoreComplexity, tierForComplexity, wantedStrengths } from "./router";

const base = { style: "balanced", mode: "auto", agentModel: "claude-sonnet-5", available: AI_MODELS } as const;
const pick = (...ids: string[]) => ids.map((id) => findModel(id)!);
const bedrockOnly = AI_MODELS.filter((model) => model.provider === "bedrock");

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

describe("wantedStrengths", () => {
  it("starts from the specialty and adds code or other languages the message shows", () => {
    expect(wantedStrengths("hi there", "assistant")).toEqual([]);
    expect(wantedStrengths("why does this function throw?", "assistant")).toEqual(["code"]);
    expect(wantedStrengths("summarize the thread", "engineering")).toEqual(["code", "tools"]);
    expect(wantedStrengths("नमस्ते, इसका जवाब दो", "writing")).toEqual(["writing", "multilingual"]);
    expect(wantedStrengths("please translate this for the Paris team", "support")).toEqual(["writing", "multilingual"]);
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

  it("stands in with a model that fits the specialty", () => {
    const devstral = findModel("mistral.devstral-2-123b")!;
    const standIn = fallbackModel(devstral, "engineering", bedrockOnly, new Set([devstral.id]));
    expect(standIn?.tier).toBe("balanced");
    expect(standIn?.strengths).toContain("code");
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

  it("matches strengths and speed among one provider's models", () => {
    expect(routeModel({ ...base, text: "thanks!", specialty: "assistant", available: bedrockOnly })?.model.id).toBe("openai.gpt-oss-120b");

    const code = routeModel({ ...base, text: "Why does this function throw on an empty list?", specialty: "engineering", available: bedrockOnly });
    expect(code?.tier).toBe("balanced");
    expect(code?.model.strengths).toEqual(expect.arrayContaining(["code", "tools"]));
    expect(code?.reason).toMatch(/strong at code and tool use/);

    // A short message in Hindi is quick, and goes to a fast model that writes well in other languages.
    expect(routeModel({ ...base, text: "नमस्ते, इसका जवाब दो", specialty: "writing", available: bedrockOnly })?.model.id).toBe(
      "mistral.ministral-3-14b-instruct",
    );
  });

  it("never lets strengths outweigh the provider preference", () => {
    const available = pick("claude-haiku-4-5", "qwen.qwen3-coder-30b-a3b-instruct");
    expect(routeModel({ ...base, text: "quick: what does this regex do?", specialty: "assistant", available })?.model.id).toBe("claude-haiku-4-5");
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
