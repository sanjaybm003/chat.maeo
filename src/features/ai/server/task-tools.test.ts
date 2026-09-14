import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { executeTaskTool, resolveAssignee } = await import("./task-tools");

const person = (id: string, name: string) => [id, { id, name, title: null, role: "member", status: null }] as const;
const directory = {
  workspaceName: "Acme",
  people: new Map([person("u-priya", "Priya Sharma"), person("u-sam", "Sam Lee"), person("u-samantha", "Samantha Ortiz")]),
  agents: new Map([["a-scout", { name: "Scout", handle: "scout" }]]),
  personName: (id: string) => (id === "u-sam" ? "Sam Lee" : "Someone"),
  authorName: () => "Someone",
} as unknown as import("./directory").NameDirectory;

describe("resolveAssignee", () => {
  const scope = { directory, userId: "u-asker" };

  it("understands me, nobody, agents and people by full or first name", () => {
    expect(resolveAssignee("me", scope)).toEqual({ assigneeId: "u-asker", agentId: null });
    expect(resolveAssignee("nobody", scope)).toEqual({ assigneeId: null, agentId: null });
    expect(resolveAssignee("@scout", scope)).toEqual({ assigneeId: null, agentId: "a-scout" });
    expect(resolveAssignee("Priya Sharma", scope)).toEqual({ assigneeId: "u-priya", agentId: null });
    expect(resolveAssignee("sam", scope)).toEqual({ assigneeId: "u-sam", agentId: null });
    expect(resolveAssignee("pri", scope)).toEqual({ assigneeId: "u-priya", agentId: null });
  });

  it("asks for a full name instead of guessing", () => {
    expect(() => resolveAssignee("sa", scope)).toThrow(/could be Sam Lee, Samantha Ortiz/);
    expect(() => resolveAssignee("Zed", scope)).toThrow(/Nobody called "Zed"/);
  });
});

describe("create_task", () => {
  it("creates the task for the asker, shared in the chat, with the resolved assignee and date", async () => {
    const rpc = vi.fn(async () => ({
      data: { number: 5, title: "Send the invoice", status: "todo", due_on: "2026-09-18", assignee_id: "u-sam", agent_id: null },
      error: null,
    }));
    const context = { admin: { rpc } as never, directory, workspaceId: "w", conversationId: "c", userId: "u-asker", agentId: "a-scout" };

    const output = await executeTaskTool(
      { id: "1", name: "create_task", input: { title: "Send the invoice", assignee: "Sam", due_on: "2026-09-18", priority: "high" } },
      context,
    );

    expect(rpc).toHaveBeenCalledWith("ai_save_task", {
      p_user_id: "u-asker",
      p_agent_id: "a-scout",
      p_task_id: null,
      p_workspace_id: "w",
      p_fields: { title: "Send the invoice", conversation_id: "c", assignee_id: "u-sam", agent_id: null, due_on: "2026-09-18", priority: "high" },
    });
    expect(output).toBe("Created T-5: Send the invoice for Sam Lee, due 2026-09-18. It's shared in this chat; refer to it as T-5.");
  });

  it("passes the database's reason back so the agent can explain it", async () => {
    const rpc = vi.fn(async () => ({ data: null, error: { code: "22023", message: "That person isn't in this workspace." } }));
    const context = { admin: { rpc } as never, directory, workspaceId: "w", conversationId: "c", userId: "u-asker", agentId: "a-scout" };
    await expect(executeTaskTool({ id: "1", name: "create_task", input: { title: "x", assignee: "Priya" } }, context)).rejects.toThrow(
      "That person isn't in this workspace.",
    );
  });
});
