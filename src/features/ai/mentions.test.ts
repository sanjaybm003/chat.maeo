import { describe, expect, it } from "vitest";

import { activeMentionQuery, extractMentionHandles, insertMention, tokenizeMentions } from "./mentions";

describe("extractMentionHandles", () => {
  it("finds handles at starts, after spaces and punctuation, case-insensitively", () => {
    expect(extractMentionHandles("@scout what did we decide? cc (@Atlas), @notes-bot.")).toEqual([
      "scout",
      "atlas",
      "notes-bot",
    ]);
  });

  it("ignores emails, glued words, repeats and invalid handles", () => {
    expect(extractMentionHandles("mail sam@scout.dev or @scout @scout @s @9lives @scout_x")).toEqual(["scout"]);
  });

  it("caps how many agents one message can wake", () => {
    expect(extractMentionHandles("@aaa @bbb @ccc @ddd", 2)).toEqual(["aaa", "bbb"]);
  });
});

describe("tokenizeMentions", () => {
  it("marks only known handles", () => {
    const tokens = tokenizeMentions("hey @scout and @nobody!", (handle) => handle === "scout");
    expect(tokens).toEqual([
      { type: "text", value: "hey " },
      { type: "mention", handle: "scout", raw: "@scout" },
      { type: "text", value: " and @nobody!" },
    ]);
  });
});

describe("composer helpers", () => {
  it("detects the mention being typed at the caret", () => {
    expect(activeMentionQuery("ask @sc", 7)).toEqual({ query: "sc", start: 4 });
    expect(activeMentionQuery("@", 1)).toEqual({ query: "", start: 0 });
    expect(activeMentionQuery("email me@sc", 11)).toBeNull();
    expect(activeMentionQuery("done @scout now", 15)).toBeNull();
  });

  it("inserts a mention and places the caret after it", () => {
    const result = insertMention("ask @sc about it", 7, 4, "scout");
    expect(result).toEqual({ text: "ask @scout about it", caret: 11 });
  });
});
