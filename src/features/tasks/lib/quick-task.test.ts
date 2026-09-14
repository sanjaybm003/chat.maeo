import { describe, expect, it } from "vitest";

import type { Agent, Member } from "@/types/domain";

import { parseQuickTask, resolveMention, TASK_COMMAND } from "./quick-task";

const member = (id: string, fullName: string, email: string, displayName: string | null = null): Member => ({
  id,
  email,
  fullName,
  displayName,
  title: null,
  statusText: null,
  avatarPath: null,
  color: "iris",
  role: "member",
  joinedAt: "2026-01-01T00:00:00Z",
  lastSeenAt: null,
});

const members = [
  member("u-priya", "Priya Sharma", "priya@team.dev"),
  member("u-sam", "Sam Lee", "sam.lee@team.dev"),
  member("u-sammy", "Samantha Ortiz", "sortiz@team.dev"),
  member("u-jo", "Joanne Park", "jo@team.dev", "Jo"),
];

const agents = [{ id: "a-scout", handle: "scout", archivedAt: null } as Agent, { id: "a-old", handle: "old", archivedAt: "2026-01-02" } as Agent];

// Monday 14 September 2026, local time.
const today = new Date(2026, 8, 14);
const parse = (text: string) => parseQuickTask(text, { members, agents }, today);

describe("TASK_COMMAND", () => {
  it("recognizes /task and /todo with or without text", () => {
    expect(TASK_COMMAND.exec("/task Fix it")?.[1]).toBe("Fix it");
    expect(TASK_COMMAND.exec("/TODO")).not.toBeNull();
    expect(TASK_COMMAND.exec("/tasks please")).toBeNull();
    expect(TASK_COMMAND.exec("task /task")).toBeNull();
  });
});

describe("resolveMention", () => {
  it("matches agents by handle and people by name, email or unambiguous prefix", () => {
    expect(resolveMention("scout", { members, agents })).toEqual({ kind: "agent", id: "a-scout" });
    expect(resolveMention("old", { members, agents })).toBeNull();
    expect(resolveMention("Priya", { members, agents })).toEqual({ kind: "person", id: "u-priya" });
    expect(resolveMention("sam.lee", { members, agents })).toEqual({ kind: "person", id: "u-sam" });
    expect(resolveMention("sam", { members, agents })).toEqual({ kind: "person", id: "u-sam" });
    expect(resolveMention("sa", { members, agents })).toBeNull();
    expect(resolveMention("jo", { members, agents })).toEqual({ kind: "person", id: "u-jo" });
    expect(resolveMention("pri", { members, agents })).toEqual({ kind: "person", id: "u-priya" });
    expect(resolveMention("nobody", { members, agents })).toBeNull();
  });
});

describe("parseQuickTask", () => {
  it("lifts assignee, due date and priority out of the title", () => {
    expect(parse("Fix the login bug @priya tomorrow !high")).toEqual({
      title: "Fix the login bug",
      assignee: { kind: "person", id: "u-priya" },
      unknownMention: null,
      dueOn: "2026-09-15",
      priority: "high",
    });
  });

  it("assigns agents and understands weekdays, relative days and month names", () => {
    expect(parse("@scout research competitor pricing by friday")).toMatchObject({
      title: "research competitor pricing",
      assignee: { kind: "agent", id: "a-scout" },
      dueOn: "2026-09-18",
    });
    expect(parse("Plan offsite next friday").dueOn).toBe("2026-09-25");
    expect(parse("Review on monday").dueOn).toBe("2026-09-21");
    expect(parse("Ship it in 3 days p0")).toMatchObject({ title: "Ship it", dueOn: "2026-09-17", priority: "urgent" });
    expect(parse("Invoice due 3 Oct").dueOn).toBe("2026-10-03");
    expect(parse("Renew domain Aug 2nd").dueOn).toBe("2027-08-02");
    expect(parse("Tax filing 2027-01-31").dueOn).toBe("2027-01-31");
    expect(parse("Wrap up by end of week")).toMatchObject({ title: "Wrap up", dueOn: "2026-09-18" });
    expect(parse("Kickoff next week").dueOn).toBe("2026-09-21");
    expect(parse("Call the bank today !low")).toMatchObject({ title: "Call the bank", dueOn: "2026-09-14", priority: "low" });
  });

  it("leaves what it doesn't recognize in the title and reports unknown people", () => {
    expect(parse("Email @nobody about 31 feb")).toEqual({
      title: "Email @nobody about 31 feb",
      assignee: null,
      unknownMention: "nobody",
      dueOn: null,
      priority: null,
    });
    expect(parse("Update the p10 dashboard").priority).toBeNull();
    expect(parse("Mondays standup notes").dueOn).toBeNull();
  });

  it("keeps only the first person as assignee and tidies separators", () => {
    expect(parse("@priya @sam - pair on onboarding -")).toMatchObject({ title: "@sam - pair on onboarding", assignee: { id: "u-priya" } });
  });
});
