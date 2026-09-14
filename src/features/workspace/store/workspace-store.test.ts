import { afterEach, describe, expect, it, vi } from "vitest";

import type { Conversation, Message, Profile } from "@/types/domain";

import { MAX_CACHED_THREADS } from "./slices/threads";
import { createWorkspaceStore } from "./workspace-store";

const me: Profile = {
  id: "me",
  email: "me@team.dev",
  fullName: "Me",
  displayName: null,
  title: null,
  statusText: null,
  avatarPath: null,
  color: "cobalt",
  onboardedAt: null,
};

function conversation(id: string, patch: Partial<Conversation> = {}): Conversation {
  return {
    id,
    kind: "direct",
    name: null,
    createdBy: "me",
    createdAt: "2026-09-13T09:00:00.000000+00:00",
    lastMessageAt: null,
    muted: false,
    lastReadAt: "2026-09-13T09:00:00.000000+00:00",
    unreadCount: 0,
    participants: [
      { userId: "me", joinedAt: "2026-09-13T09:00:00Z", lastReadAt: "2026-09-13T09:00:00Z" },
      { userId: "them", joinedAt: "2026-09-13T09:00:00Z", lastReadAt: "2026-09-13T09:00:00Z" },
    ],
    lastMessage: null,
    agentId: null,
    agentIds: [],
    ...patch,
  };
}

function message(id: string, patch: Partial<Message> = {}): Message {
  const createdAt = patch.createdAt ?? "2026-09-13T10:00:00.000000+00:00";
  return {
    id,
    conversationId: "c1",
    senderId: "them",
    agentId: null,
    kind: "text",
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
    ...patch,
  };
}

function makeStore(conversations: Conversation[] = [conversation("c1")]) {
  return createWorkspaceStore({
    me,
    workspace: { id: "w", name: "W", slug: "w", teamSize: null, useCase: null, membersCanInvite: true, createdAt: "" },
    myRole: "owner",
    workspaces: [],
    members: [],
    ai: { ready: true, models: [], agents: [], credits: null },
    conversations,
    pendingInvitations: [],
  });
}

afterEach(() => vi.useRealTimers());

describe("threads", () => {
  it("drops stale versions and applies newer ones (last writer wins)", () => {
    const store = makeStore();
    store.getState().setThread("c1", [message("m1", { body: "v3", version: 3 })], false);

    store.getState().receiveMessage(message("m1", { body: "v2", version: 2 }), { keepReactions: true });
    expect(store.getState().threads.c1.messages[0].body).toBe("v3");

    store.getState().receiveMessage(message("m1", { body: "v4", version: 4 }), { keepReactions: true });
    expect(store.getState().threads.c1.messages[0].body).toBe("v4");
  });

  it("keeps reactions when a realtime payload has none", () => {
    const store = makeStore();
    store.getState().setThread("c1", [message("m1", { reactions: [{ emoji: "👍", userId: "me" }] })], false);
    store.getState().receiveMessage(message("m1", { body: "edited", version: 2 }), { keepReactions: true });
    expect(store.getState().threads.c1.messages[0]).toMatchObject({ body: "edited", reactions: [{ emoji: "👍", userId: "me" }] });
  });

  it("advances the sync cursor only for server-confirmed messages", () => {
    const store = makeStore();
    store.getState().setThread("c1", [message("m1")], false);
    expect(store.getState().threads.c1.cursor).toEqual({ at: "2026-09-13T10:00:00.000000+00:00", id: "m1" });

    store.getState().receiveMessage(
      message("m2", { senderId: "me", delivery: "sending", createdAt: "2026-09-13T10:01:00.000Z", updatedAt: "2026-09-13T10:01:00.000Z" }),
    );
    expect(store.getState().threads.c1.cursor?.id).toBe("m1");

    store.getState().receiveMessage(
      message("m2", { senderId: "me", createdAt: "2026-09-13T10:01:00.100000+00:00", updatedAt: "2026-09-13T10:01:00.100000+00:00" }),
    );
    expect(store.getState().threads.c1.cursor?.id).toBe("m2");
    expect(store.getState().threads.c1.messages).toHaveLength(2);
  });

  it("updates the chat preview when the latest message changes", () => {
    const store = makeStore();
    store.getState().setThread("c1", [message("m1")], false);
    store.getState().receiveMessage(message("m1"));
    store.getState().applyChanges("c1", [message("m1", { body: "", deletedAt: "2026-09-13T10:05:00Z", version: 2 })]);
    expect(store.getState().conversations.c1.lastMessage).toMatchObject({ id: "m1", deletedAt: "2026-09-13T10:05:00Z" });
  });

  it("evicts the least recently viewed threads but never the open one or unsent work", () => {
    vi.useFakeTimers();
    const ids = Array.from({ length: MAX_CACHED_THREADS + 3 }, (_, index) => `c${index}`);
    const store = makeStore(ids.map((id) => conversation(id)));

    ids.forEach((id, index) => {
      vi.setSystemTime(1000 + index);
      store.getState().startThreadLoad(id);
      store.getState().setThread(id, [message(`m-${id}`, { conversationId: id })], false);
    });
    store.getState().receiveMessage(message("pending", { conversationId: "c0", delivery: "sending" }));

    vi.setSystemTime(10_000);
    store.getState().setActiveConversation("c1");

    const kept = Object.keys(store.getState().threads);
    expect(kept).toHaveLength(MAX_CACHED_THREADS);
    expect(kept).toContain("c0");
    expect(kept).toContain("c1");
    expect(kept).not.toContain("c2");
  });
});

describe("conversations and presence", () => {
  it("clears unread when I've read past the latest message", () => {
    const store = makeStore([
      conversation("c1", {
        unreadCount: 3,
        lastMessage: {
          id: "m9",
          senderId: "them",
          agentId: null,
          agentStatus: null,
          kind: "text",
          body: "hi",
          meta: {},
          attachmentCount: 0,
          deletedAt: null,
          createdAt: "2026-09-13T10:00:00Z",
        },
      }),
    ]);
    store.getState().setParticipantRead("c1", "me", "2026-09-13T09:59:00Z");
    expect(store.getState().conversations.c1.unreadCount).toBe(3);
    store.getState().setParticipantRead("c1", "me", "2026-09-13T10:00:00Z");
    expect(store.getState().conversations.c1.unreadCount).toBe(0);
  });

  it("splits presence into active and away", () => {
    const store = makeStore();
    store.getState().setPresence([
      { userId: "a", status: "active" },
      { userId: "b", status: "away" },
    ]);
    expect(store.getState().online).toEqual({ a: true });
    expect(store.getState().away).toEqual({ b: true });
  });
});
