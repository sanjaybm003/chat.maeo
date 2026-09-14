import { describe, expect, it } from "vitest";

import { taskEventFor, taskEventText, type TaskEventDetails } from "./task-events";

const state = (overrides: Partial<{ status: "todo" | "in_progress" | "done"; assigneeId: string | null; agentId: string | null; version: number }> = {}) => ({
  status: "todo" as const,
  assigneeId: null,
  agentId: null,
  version: 1,
  ...overrides,
});

describe("taskEventFor", () => {
  it("names the change a save made", () => {
    expect(taskEventFor(null, state())).toBe("task.created");
    expect(taskEventFor(state(), state({ status: "done", version: 2 }))).toBe("task.completed");
    expect(taskEventFor(state(), state({ assigneeId: "bob", version: 2 }))).toBe("task.assigned");
    expect(taskEventFor(state({ assigneeId: "bob" }), state({ agentId: "scout", version: 2 }))).toBe("task.assigned");
    expect(taskEventFor(state({ assigneeId: "bob" }), state({ assigneeId: null, version: 2 }))).toBe("task.updated");
    expect(taskEventFor(state(), state({ status: "in_progress", version: 2 }))).toBe("task.updated");
    expect(taskEventFor(state({ status: "done" }), state({ status: "done", version: 2 }))).toBe("task.updated");
  });

  it("stays quiet when the save changed nothing", () => {
    expect(taskEventFor(state({ version: 3 }), state({ version: 3 }))).toBeNull();
  });
});

describe("taskEventText", () => {
  const details: TaskEventDetails = {
    event: "task.created",
    number: 12,
    title: "Ship <the> launch post",
    status: "todo",
    actor: "Priya",
    assignee: "Bob",
    dueOn: "2026-10-01",
    url: "https://chat.example.com/w/acme/tasks/12",
  };

  it("writes for Slack, Discord and plain JSON", () => {
    expect(taskEventText(details, "slack")).toBe(
      "*T-12* <https://chat.example.com/w/acme/tasks/12|Ship &lt;the&gt; launch post> was created by Priya for Bob · due 2026-10-01",
    );
    expect(taskEventText({ ...details, title: "Fix [urgent] bug" }, "discord")).toBe(
      "**T-12** [Fix \\[urgent\\] bug](<https://chat.example.com/w/acme/tasks/12>) was created by Priya for Bob · due 2026-10-01",
    );
    expect(taskEventText({ ...details, event: "task.completed", status: "done", actor: "Scout for Priya" }, "json")).toBe(
      "T-12 Ship <the> launch post was finished by Scout for Priya · https://chat.example.com/w/acme/tasks/12",
    );
  });

  it("describes assignments and other changes", () => {
    expect(taskEventText({ ...details, event: "task.assigned", dueOn: null }, "json")).toBe(
      "T-12 Ship <the> launch post was assigned to Bob by Priya · https://chat.example.com/w/acme/tasks/12",
    );
    expect(taskEventText({ ...details, event: "task.updated", status: "blocked", dueOn: null }, "json")).toMatch(/was updated by Priya · Blocked/);
  });
});
