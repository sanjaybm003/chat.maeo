import { describe, expect, it } from "vitest";

import type { Agent } from "@/types/domain";

import { agentsToWake } from "./wake";

function agent(id: string, handle: string, patch: Partial<Agent> = {}): Agent {
  return {
    id,
    workspaceId: "w",
    createdBy: "me",
    name: handle,
    handle,
    tagline: "",
    instructions: "You help the team with their work every day.",
    knowledge: "",
    rules: "",
    examples: [],
    creativity: "balanced",
    doubleCheck: false,
    specialty: "assistant",
    responseStyle: "balanced",
    modelMode: "auto",
    model: "claude-sonnet-5",
    tools: [],
    starters: [],
    color: "iris",
    glyph: "orbit",
    visibility: "workspace",
    archivedAt: null,
    createdAt: "",
    updatedAt: "",
    ...patch,
  };
}

const agents = {
  a1: agent("a1", "scout"),
  a2: agent("a2", "quill"),
  a3: agent("a3", "atlas"),
  a4: agent("a4", "ledger"),
  old: agent("old", "retired", { archivedAt: "2026-09-01T00:00:00Z" }),
};

describe("agentsToWake", () => {
  it("wakes nobody for plain messages", () => {
    expect(agentsToWake("see you tomorrow", { agentId: null }, agents)).toEqual([]);
  });

  it("orders the room agent, the replied-to agent, then mentions, without repeats", () => {
    const woken = agentsToWake("@atlas and @scout, thoughts?", { agentId: "a1" }, agents, { agentId: "a2" });
    expect(woken.map((item) => item.handle)).toEqual(["scout", "quill", "atlas"]);
  });

  it("carries a thread on when someone replies to an agent", () => {
    expect(agentsToWake("what about next week?", { agentId: null }, agents, { agentId: "a2" }).map((item) => item.handle)).toEqual(["quill"]);
  });

  it("skips archived agents and caps how many one message wakes", () => {
    expect(agentsToWake("@retired hello", { agentId: "old" }, agents, { agentId: "old" })).toEqual([]);
    expect(agentsToWake("@scout @quill @atlas @ledger", undefined, agents)).toHaveLength(3);
  });
});
