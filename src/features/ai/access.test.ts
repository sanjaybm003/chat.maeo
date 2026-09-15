import { describe, expect, it } from "vitest";

import { agentAccess, canShareAgent, canUseAgent, describeSharing } from "./access";

const agent = (overrides: Partial<Parameters<typeof agentAccess>[0]> = {}) => ({
  createdBy: "maker",
  visibility: "workspace" as const,
  usage: "viewers" as const,
  members: [],
  ...overrides,
});

describe("agentAccess", () => {
  it("mirrors the database's rules", () => {
    expect(agentAccess(agent(), "maker", "member")).toBe("edit");
    expect(agentAccess(agent(), "sam", "member")).toBe("use");
    expect(agentAccess(agent(), "admin", "admin")).toBe("edit");
    expect(agentAccess(agent({ usage: "owner" }), "sam", "member")).toBe("view");
    expect(agentAccess(agent({ usage: "people", members: [{ userId: "sam", role: "user" }] }), "sam", "member")).toBe("use");
    expect(agentAccess(agent({ visibility: "people", usage: "people", members: [{ userId: "sam", role: "viewer" }] }), "sam", "member")).toBe("view");
    expect(agentAccess(agent({ visibility: "people", members: [{ userId: "sam", role: "editor" }] }), "sam", "member")).toBe("edit");
    // Seen only through a chat it works in.
    expect(agentAccess(agent({ visibility: "people" }), "sam", "admin")).toBe("view");
    expect(agentAccess(agent({ visibility: "private" }), "sam", "owner")).toBe("view");
  });

  it("keeps sharing with the maker and admins, and using with users", () => {
    expect(canShareAgent(agent({ members: [{ userId: "sam", role: "editor" }] }), "sam", "member")).toBe(false);
    expect(canShareAgent(agent(), "admin", "admin")).toBe(true);
    expect(canUseAgent(agent({ usage: "owner" }), "sam", "member")).toBe(false);
  });

  it("describes who has it", () => {
    expect(describeSharing(agent())).toBe("Everyone here sees it and can use it");
    expect(describeSharing(agent({ visibility: "private" }))).toBe("Only its maker");
    expect(describeSharing(agent({ visibility: "people", usage: "people", members: [{ userId: "a", role: "user" }, { userId: "b", role: "viewer" }] }))).toBe(
      "Shared with 2 people · chosen people use it",
    );
  });
});
