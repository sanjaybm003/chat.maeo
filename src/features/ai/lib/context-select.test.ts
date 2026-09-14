import { describe, expect, it } from "vitest";

import { keywords, selectContext, type ContextMessage } from "./context-select";

const note = (index: number, patch: Partial<ContextMessage> = {}): ContextMessage => ({
  id: `m${index}`,
  body: `note number ${index} about lunch plans`,
  replyToId: null,
  agentId: null,
  ...patch,
});

describe("keywords", () => {
  it("keeps content words, most frequent first", () => {
    expect(keywords("What did we decide about the Budget? The budget for Q4 and the launch budget", 3)).toEqual(["budget", "decide", "launch"]);
    expect(keywords("see https://example.com/budget and ```const budget = 1```")).toEqual(["see"]);
  });
});

describe("selectContext", () => {
  const options = { agentId: "agent-1", handle: "scout" };

  it("keeps the newest messages and fills the rest by relevance within the budget", () => {
    const history = Array.from({ length: 30 }, (_, index) => note(index));
    history[3] = note(3, { body: "the marketing budget is 40k for october" });
    const size = history[0].body.length + 80;

    const result = selectContext(history, { body: "what is the marketing budget?", replyToId: null }, { ...options, keepRecent: 5, maxChars: size * 8 });
    const ids = result.messages.map((message) => message.id);

    expect(ids).toContain("m3");
    expect(ids.slice(-5)).toEqual(["m25", "m26", "m27", "m28", "m29"]);
    expect(ids).not.toContain("m10");
    expect(result.gapsBefore.has("m3")).toBe(true);
    expect(result.omitted).toBe(30 - ids.length);
    expect(ids).toEqual([...ids].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))));
  });

  it("always includes the reply chain the question belongs to", () => {
    const history = Array.from({ length: 40 }, (_, index) => note(index));
    history[2] = note(2, { body: "original proposal" });
    history[5] = note(5, { body: "counter proposal", replyToId: "m2" });
    const size = history[0].body.length + 80;

    const result = selectContext(history, { body: "which one do you prefer", replyToId: "m5" }, { ...options, keepRecent: 2, maxChars: size * 4 });
    expect(result.messages.map((message) => message.id)).toEqual(expect.arrayContaining(["m2", "m5", "m38", "m39"]));
  });

  it("favours the agent's own earlier replies and mentions of it", () => {
    const history = Array.from({ length: 40 }, (_, index) => note(index));
    history[1] = note(1, { agentId: "agent-1", body: "earlier answer" });
    history[4] = note(4, { body: "@scout can you look at this" });
    const size = history[0].body.length + 80;

    const ids = selectContext(history, { body: "and now?", replyToId: null }, { ...options, keepRecent: 3, maxChars: size * 6 }).messages.map(
      (message) => message.id,
    );
    expect(ids).toEqual(expect.arrayContaining(["m1", "m4"]));
  });

  it("returns everything when it fits, with no gaps", () => {
    const history = Array.from({ length: 6 }, (_, index) => note(index));
    const result = selectContext(history, { body: "hi", replyToId: null }, options);
    expect(result.messages).toHaveLength(6);
    expect(result.gapsBefore.size).toBe(0);
  });
});
