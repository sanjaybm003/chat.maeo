import { describe, expect, it } from "vitest";

import type { Message } from "@/types/domain";

import { buildTimeline, groupReactions } from "./timeline";

const ME = "me";
const THEM = "them";

function at(day: number, hour: number, minute: number) {
  return new Date(2026, 8, day, hour, minute).toISOString();
}

function message(id: string, senderId: string, createdAt: string, kind: Message["kind"] = "text"): Message {
  return {
    id,
    conversationId: "c",
    senderId,
    agentId: null,
    kind,
    body: id,
    attachments: [],
    meta: {},
    run: null,
    replyToId: null,
    replyTo: null,
    editedAt: null,
    deletedAt: null,
    createdAt,
    updatedAt: createdAt,
    version: 1,
    reactions: [],
    delivery: "sent",
  };
}

describe("buildTimeline", () => {
  it("adds a day divider for each new day and groups runs from one sender", () => {
    const rows = buildTimeline(
      [
        message("a", THEM, at(12, 9, 0)),
        message("b", THEM, at(12, 9, 2)),
        message("c", ME, at(12, 9, 3)),
        message("d", ME, at(13, 10, 0)),
      ],
      null,
      ME,
    );

    expect(rows.map((row) => row.type)).toEqual(["day", "message", "message", "message", "day", "message"]);
    const messages = rows.filter((row) => row.type === "message");
    expect(messages.map((row) => [row.startsGroup, row.endsGroup])).toEqual([
      [true, false],
      [false, true],
      [true, true],
      [true, true],
    ]);
  });

  it("breaks a run after the grouping window", () => {
    const rows = buildTimeline([message("a", THEM, at(12, 9, 0)), message("b", THEM, at(12, 9, 30))], null, ME);
    const messages = rows.filter((row) => row.type === "message");
    expect(messages.every((row) => row.startsGroup && row.endsGroup)).toBe(true);
  });

  it("places one unread marker before the first unread message from someone else", () => {
    const rows = buildTimeline(
      [
        message("a", THEM, at(12, 9, 0)),
        message("b", ME, at(12, 9, 5)),
        message("c", THEM, at(12, 9, 10)),
        message("d", THEM, at(12, 9, 11)),
      ],
      at(12, 9, 7),
      ME,
    );
    const types = rows.map((row) => (row.type === "message" ? row.message.id : row.type));
    expect(types).toEqual(["day", "a", "b", "unread", "c", "d"]);
  });

  it("renders system messages on their own and never crashes on the last message", () => {
    const rows = buildTimeline([message("a", THEM, at(12, 9, 0)), message("s", THEM, at(12, 9, 1), "system")], null, ME);
    expect(rows.map((row) => row.type)).toEqual(["day", "message", "system"]);
  });
});

describe("groupReactions", () => {
  it("groups by emoji keeping first-seen order", () => {
    expect(
      groupReactions([
        { emoji: "👍", userId: "a" },
        { emoji: "🎉", userId: "b" },
        { emoji: "👍", userId: "c" },
      ]),
    ).toEqual([
      { emoji: "👍", userIds: ["a", "c"] },
      { emoji: "🎉", userIds: ["b"] },
    ]);
  });
});
