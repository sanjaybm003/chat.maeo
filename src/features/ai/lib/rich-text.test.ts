import { describe, expect, it } from "vitest";

import { parseBlocks, plainText } from "./rich-text";

describe("parseBlocks", () => {
  it("splits headings, lists, quotes, rules and paragraphs", () => {
    const blocks = parseBlocks(
      ["## Decisions", "We agreed on two things:", "still the same paragraph", "", "- Ship Monday", "- Freeze on Friday", "  after review", "", "1. Draft", "2. Review", "", "> quoted", "---", "Done."].join("\n"),
    );
    expect(blocks).toEqual([
      { type: "heading", text: "Decisions" },
      { type: "paragraph", lines: ["We agreed on two things:", "still the same paragraph"] },
      { type: "list", ordered: false, start: 1, items: ["Ship Monday", "Freeze on Friday after review"] },
      { type: "list", ordered: true, start: 1, items: ["Draft", "Review"] },
      { type: "quote", lines: ["quoted"] },
      { type: "rule" },
      { type: "paragraph", lines: ["Done."] },
    ]);
  });

  it("keeps fenced code verbatim, even when unclosed", () => {
    expect(parseBlocks("```ts\nconst a = 1;\n- not a list\n```")).toEqual([{ type: "code", text: "const a = 1;\n- not a list" }]);
    expect(parseBlocks("```\nopen")).toEqual([{ type: "code", text: "open" }]);
  });

  it("parses tables and pads short rows", () => {
    expect(parseBlocks("| Owner | Task |\n|---|:---:|\n| Sam | Launch |\n| Ana |")).toEqual([
      { type: "table", header: ["Owner", "Task"], rows: [["Sam", "Launch"], ["Ana", ""]] },
    ]);
  });

  it("does not treat a lone pipe as a table", () => {
    expect(parseBlocks("a | b")).toEqual([{ type: "paragraph", lines: ["a | b"] }]);
  });
});

describe("plainText", () => {
  it("flattens markdown into one readable line", () => {
    expect(plainText("## Plan\n- **Ship** on `Monday`\n```js\nx()\n```")).toBe("Plan Ship on Monday [code]");
  });
});
