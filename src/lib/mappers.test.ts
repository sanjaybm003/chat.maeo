import { describe, expect, it } from "vitest";

import { mapMessage } from "./mappers";

describe("mapMessage", () => {
  it("maps a realtime payload including versioning fields", () => {
    const message = mapMessage({
      id: "m1",
      conversation_id: "c1",
      sender_id: "u1",
      kind: "text",
      body: "hello",
      attachments: [{ path: "c1/u1/file.png", name: "file.png", size: 10, type: "image/png", width: 4, height: 3 }],
      meta: {},
      reply_to_id: null,
      edited_at: null,
      deleted_at: null,
      created_at: "2026-09-13T10:00:00.000000+00:00",
      updated_at: "2026-09-13T10:05:00.000000+00:00",
      version: 3,
    });

    expect(message).toMatchObject({
      id: "m1",
      version: 3,
      updatedAt: "2026-09-13T10:05:00.000000+00:00",
      delivery: "sent",
      attachments: [{ name: "file.png", width: 4, height: 3 }],
    });
  });

  it("drops malformed attachments and reactions instead of trusting them", () => {
    const message = mapMessage({
      id: "m1",
      conversation_id: "c1",
      attachments: [{ name: "no-path" }, "garbage", { path: "c1/u1/a.pdf", name: "a.pdf" }],
      reactions: [{ emoji: "👍" }, { emoji: "🎉", user_id: "u2" }],
      created_at: "2026-09-13T10:00:00Z",
    });
    expect(message?.attachments).toHaveLength(1);
    expect(message?.reactions).toEqual([{ emoji: "🎉", userId: "u2" }]);
    expect(message?.version).toBe(1);
    expect(message?.updatedAt).toBe("2026-09-13T10:00:00Z");
  });

  it("rejects payloads without identity", () => {
    expect(mapMessage({ body: "hi" })).toBeNull();
    expect(mapMessage(null)).toBeNull();
  });
});
