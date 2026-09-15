import { describe, expect, it } from "vitest";

import type { Task } from "@/types/domain";

import { summarizeWork, workUpdate } from "./task-meta";

const ME = "me";

const task = (fields: Partial<Task> & Pick<Task, "number" | "title">): Task => ({
  id: `task-${fields.number}`,
  workspaceId: "w1",
  description: "",
  status: "todo",
  priority: "none",
  assigneeId: null,
  agentId: null,
  dueOn: null,
  conversationId: null,
  messageId: null,
  createdBy: ME,
  createdByAgent: null,
  completedAt: null,
  createdAt: "2026-09-01T00:00:00Z",
  updatedAt: "2026-09-01T00:00:00Z",
  version: 1,
  ...fields,
});

const late = task({ number: 1, title: "Send invoice", assigneeId: ME, dueOn: "2026-09-10" });
const underway = task({ number: 2, title: "Call Sam", assigneeId: ME, dueOn: "2026-09-15", status: "in_progress" });
const inChat = task({ number: 3, title: "Book the venue", assigneeId: "sam", conversationId: "c1" });
const withAgent = task({ number: 4, title: "Research venues", agentId: "a1" });
const doneToday = task({ number: 5, title: "Ship notes", assigneeId: ME, status: "done", completedAt: "2026-09-15T09:00:00Z" });
const blocked = task({ number: 6, title: "Fix login", assigneeId: ME, status: "blocked" });
const doneBefore = task({ number: 7, title: "Old work", assigneeId: ME, status: "done", completedAt: "2026-09-14T09:00:00Z" });
const all = [late, underway, inChat, withAgent, doneToday, blocked, doneBefore];

describe("summarizeWork", () => {
  it("gathers open work, what's late or due, this chat, agents and today's finished work", () => {
    const work = summarizeWork(all, ME, { conversationId: "c1", today: "2026-09-15", since: "2026-09-15T00:00:00Z" });
    expect(work.mine.map((item) => item.number)).toEqual([1, 2, 6]);
    expect(work.late).toBe(1);
    expect(work.dueToday).toBe(1);
    expect(work.here).toEqual([inChat]);
    expect(work.withAgents).toEqual([withAgent]);
    expect(work.finished).toEqual([doneToday]);
  });

  it("counts nothing late or finished before the date is known", () => {
    const work = summarizeWork(all, ME, { conversationId: null, today: null, since: null });
    expect(work.late).toBe(0);
    expect(work.here).toEqual([]);
    expect(work.finished).toEqual([]);
  });
});

describe("workUpdate", () => {
  it("writes done, underway, blocked and next in plain lines", () => {
    const work = summarizeWork(all, ME, { conversationId: "c1", today: "2026-09-15", since: "2026-09-15T00:00:00Z" });
    expect(workUpdate(work, "2026-09-15")).toBe(
      ["My update", "Done: T-5 Ship notes", "Working on: T-2 Call Sam (due today)", "Blocked: T-6 Fix login", "Next: T-1 Send invoice (late)"].join("\n"),
    );
  });

  it("says so when nothing is open", () => {
    const work = summarizeWork([], ME, { conversationId: null, today: "2026-09-15", since: "2026-09-15T00:00:00Z" });
    expect(workUpdate(work, "2026-09-15")).toBe("My update\nNothing open on my side right now.");
  });
});
