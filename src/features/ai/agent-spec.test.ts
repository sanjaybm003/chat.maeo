import { describe, expect, it } from "vitest";

import { agentInputSchema, HANDLE_PATTERN, normalizeDraft, toHandle } from "./agent-spec";

describe("toHandle", () => {
  it("turns names into valid mention handles", () => {
    expect(toHandle("Release Notes Writer")).toBe("release-notes-writer");
    expect(toHandle("  Café Scout! ")).toBe("cafe-scout");
    expect(toHandle("42 Crew")).toBe("crew");
    expect(toHandle("Q")).toBe("q-ai");
    expect(toHandle("An extremely long agent name that keeps going")).toMatch(HANDLE_PATTERN);
  });
});

describe("normalizeDraft", () => {
  it("clamps, fixes and fills an architect draft", () => {
    const draft = normalizeDraft({
      name: "  Scout  ",
      handle: "@Not Valid!",
      tagline: "Finds   what you need",
      instructions: "You help the team find decisions in past conversations quickly.",
      tools: ["search", "search", "teleport", "history"],
      starters: ["  What did we decide?  ", "", "a", "b", "c"],
      color: "neon",
      glyph: "spark",
      tier: "galaxy-brain",
    });

    expect(draft).toMatchObject({
      name: "Scout",
      handle: "scout",
      tagline: "Finds what you need",
      tools: ["search", "history"],
      starters: ["What did we decide?", "a", "b"],
      color: "iris",
      glyph: "spark",
      tier: "balanced",
    });
  });
});

describe("agentInputSchema", () => {
  const valid = {
    workspaceId: "11111111-1111-4111-8111-111111111111",
    name: "Scout",
    handle: "Scout",
    instructions: "You help the team find decisions in past conversations quickly.",
    model: "claude-opus-5",
    tools: ["search", "search"],
    starters: [],
    color: "cobalt",
    glyph: "orbit",
    visibility: "workspace",
  };

  it("normalizes handles and de-duplicates tools", () => {
    const parsed = agentInputSchema.parse(valid);
    expect(parsed.handle).toBe("scout");
    expect(parsed.tools).toEqual(["search"]);
    expect(parsed.tagline).toBe("");
  });

  it("rejects bad handles and thin instructions", () => {
    expect(agentInputSchema.safeParse({ ...valid, handle: "9lives" }).success).toBe(false);
    expect(agentInputSchema.safeParse({ ...valid, instructions: "Be nice." }).success).toBe(false);
  });
});
