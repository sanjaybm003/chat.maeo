import { describe, expect, it } from "vitest";

import type { Task } from "@/types/domain";

import { compareTasks, describeDue, groupByStatus, inView, matchesTaskQuery, taskKey } from "./task-meta";

const task = (overrides: Partial<Task>): Task => ({
  id: `t-${overrides.number ?? 1}`,
  workspaceId: "w",
  number: 1,
  title: "Task",
  description: "",
  status: "todo",
  priority: "none",
  assigneeId: null,
  agentId: null,
  dueOn: null,
  conversationId: null,
  messageId: null,
  createdBy: "me",
  createdByAgent: null,
  completedAt: null,
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
  version: 1,
  ...overrides,
});

describe("describeDue", () => {
  const today = "2026-09-14";
  it("speaks in days close by and dates further out", () => {
    expect(describeDue("2026-09-12", today)).toEqual({ label: "2 days late", tone: "overdue" });
    expect(describeDue("2026-09-13", today)).toEqual({ label: "Yesterday", tone: "overdue" });
    expect(describeDue("2026-09-14", today)).toEqual({ label: "Today", tone: "today" });
    expect(describeDue("2026-09-15", today)).toEqual({ label: "Tomorrow", tone: "soon" });
    expect(describeDue("2026-09-18", today)).toEqual({ label: "Friday", tone: "soon" });
    expect(describeDue("2026-10-03", today)).toEqual({ label: "3 Oct", tone: "later" });
    expect(describeDue("2027-01-05", today)).toEqual({ label: "5 Jan 2027", tone: "later" });
  });
});

describe("compareTasks", () => {
  it("puts urgent, then soonest due, then newest open work before finished work", () => {
    const tasks = [
      task({ number: 1, status: "done", completedAt: "2026-09-10T00:00:00Z" }),
      task({ number: 2, priority: "low", dueOn: "2026-09-15" }),
      task({ number: 3, priority: "urgent" }),
      task({ number: 4, priority: "low" }),
      task({ number: 5, status: "cancelled", updatedAt: "2026-09-12T00:00:00Z" }),
      task({ number: 6, priority: "low", dueOn: "2026-09-14" }),
    ];
    expect([...tasks].sort(compareTasks).map((item) => item.number)).toEqual([3, 6, 2, 4, 5, 1]);
  });
});

describe("views, search and grouping", () => {
  it("filters by view and matches numbers, words and assignees", () => {
    const mine = task({ number: 12, title: "Fix login bug", assigneeId: "me", createdBy: "other" });
    const agents = task({ number: 13, title: "Research pricing", agentId: "scout" });
    expect(inView(mine, "mine", "me")).toBe(true);
    expect(inView(mine, "created", "me")).toBe(false);
    expect(inView(agents, "agents", "me")).toBe(true);
    expect(matchesTaskQuery(mine, "T-12", null)).toBe(true);
    expect(matchesTaskQuery(mine, "login fix", null)).toBe(true);
    expect(matchesTaskQuery(mine, "priya", "Priya Sharma")).toBe(true);
    expect(matchesTaskQuery(mine, "pricing", null)).toBe(false);
    expect(taskKey(12)).toBe("T-12");
  });

  it("groups work underway first and drops empty groups", () => {
    const groups = groupByStatus([task({ number: 1 }), task({ number: 2, status: "in_progress" }), task({ number: 3, status: "done" })]);
    expect(groups.map((group) => group.status)).toEqual(["in_progress", "todo", "done"]);
  });
});
