import { describe, expect, it, vi } from "vitest";

import type { Tables } from "@/types/database";

vi.mock("server-only", () => ({}));

const { agentSystemPrompt } = await import("./context");

const agent = (patch: Partial<Tables<"ai_agents">> = {}): Tables<"ai_agents"> => ({
  id: "a",
  workspace_id: "w",
  created_by: "u",
  name: "Dev",
  handle: "dev",
  tagline: "",
  instructions: "You help the team ship reliable code and answer questions about it.",
  model: "deepseek.v3.2",
  tools: [],
  starters: [],
  color: "iris",
  glyph: "prism",
  specialty: "engineering",
  response_style: "balanced",
  knowledge: "",
  model_mode: "auto",
  rules: "",
  examples: [],
  creativity: "balanced",
  double_check: false,
  visibility: "workspace",
  archived_at: null,
  created_at: "",
  updated_at: "",
  ...patch,
});

describe("agentSystemPrompt", () => {
  it("adds the team's rules and liked replies only when there are some", () => {
    const plain = agentSystemPrompt(agent(), "Acme");
    expect(plain).not.toContain("# Team rules");
    expect(plain).not.toContain("# Replies the team liked");
    expect(plain).toContain("You can only reply in this chat.");

    const tuned = agentSystemPrompt(
      agent({ rules: "Always give prices in INR.", examples: [{ prompt: "What does Team cost?", reply: "₹650 a seat a month." }] }),
      "Acme",
    );
    expect(tuned).toContain("<rules>\nAlways give prices in INR.\n</rules>");
    expect(tuned).toContain("<example>\n<message>What does Team cost?</message>\n<reply>₹650 a seat a month.</reply>\n</example>");
  });

  it("explains the tools the agent has, and says so when GitHub isn't connected", () => {
    const connected = agentSystemPrompt(agent({ tools: ["web", "tasks", "github"] }), "Acme", { githubConnected: true });
    expect(connected).toContain("- The web:");
    expect(connected).toContain("check list_tasks first");
    expect(connected).toContain("never say code is merged or deployed");
    expect(connected).toContain("Besides replying here you can manage the team's tasks and open pull requests on GitHub.");

    const disconnected = agentSystemPrompt(agent({ tools: ["github"] }), "Acme", { githubConnected: false });
    expect(disconnected).toContain("a workspace admin can connect GitHub in Settings");
    expect(disconnected).toContain("You can only reply in this chat.");
  });
});
