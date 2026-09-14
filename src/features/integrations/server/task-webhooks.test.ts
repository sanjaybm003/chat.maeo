import { createHmac } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminClient } from "@/features/ai/server/directory";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => {
  const quiet = { debug() {}, info() {}, warn() {}, error() {}, child: () => quiet };
  return { logger: quiet };
});
// Public hostnames resolve to a public address; nothing touches real DNS.
vi.mock("node:dns/promises", () => ({ lookup: async () => [{ address: "93.184.216.34", family: 4 }] }));

const load = () => import("./task-webhooks");

interface Target {
  id: string;
  name: string;
  url: string;
  format: string;
  secret: string;
}

/** Just enough of the Supabase client for delivery: row lookups and the two service functions. */
function fakeAdmin(targets: Target[]) {
  const rows: Record<string, unknown> = {
    tasks: {
      id: "task-1",
      workspace_id: "ws-1",
      number: 12,
      title: "Ship the launch post",
      description: "",
      status: "done",
      priority: "high",
      assignee_id: "bob",
      agent_id: null,
      due_on: "2026-10-01",
      created_at: "2026-09-10T10:00:00Z",
      updated_at: "2026-09-15T10:00:00Z",
      completed_at: "2026-09-15T10:00:00Z",
    },
    workspaces: { id: "ws-1", name: "Acme", slug: "acme" },
    profiles: { display_name: "Bob", full_name: "Bob Stone", email: "bob@acme.dev" },
  };
  const deliveries: Array<{ id: unknown; status: unknown }> = [];
  const lookups: Array<Record<string, unknown>> = [];
  const query = (data: unknown) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      maybeSingle: async () => ({ data, error: null }),
      single: async () => ({ data, error: null }),
    };
    return chain;
  };
  const admin = {
    from: (table: string) => query(rows[table] ?? null),
    rpc: async (name: string, args: Record<string, unknown>) => {
      if (name === "task_webhook_targets") {
        lookups.push(args);
        return { data: targets, error: null };
      }
      deliveries.push({ id: args.p_webhook_id, status: args.p_status });
      return { data: null, error: null };
    },
  } as unknown as AdminClient;
  return { admin, deliveries, lookups };
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://chat.example.com");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("deliverTaskEvent", () => {
  it("signs every request, writes Slack's shape for Slack and a full payload for JSON, and records each delivery", async () => {
    const requests: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL, init: RequestInit) => {
        requests.push({ url: String(input), headers: init.headers as Record<string, string>, body: String(init.body) });
        return new Response(null, { status: 200 });
      }),
    );
    const { deliverTaskEvent } = await load();
    const { admin, deliveries, lookups } = fakeAdmin([
      { id: "hook-slack", name: "Slack", url: "https://hooks.slack.com/services/T0/B0/x", format: "slack", secret: "slack-secret" },
      { id: "hook-json", name: "Zapier", url: "https://hooks.zapier.com/hooks/catch/1/abc", format: "json", secret: "json-secret" },
    ]);

    const tried = await deliverTaskEvent(admin, { event: "task.completed", taskId: "task-1", actorName: "Priya" });

    expect(tried).toBe(2);
    expect(lookups).toEqual([{ p_workspace_id: "ws-1", p_event: "task.completed" }]);
    const slack = requests.find((request) => request.url.includes("slack"))!;
    expect(JSON.parse(slack.body)).toEqual({ text: expect.stringMatching(/^\*T-12\* <https:\/\/chat\.example\.com\/.+\|Ship the launch post> was finished by Priya$/) });

    const json = requests.find((request) => request.url.includes("zapier"))!;
    const payload = JSON.parse(json.body);
    expect(payload).toMatchObject({
      event: "task.completed",
      actor: "Priya",
      workspace: { id: "ws-1", name: "Acme" },
      task: { key: "T-12", status: "done", assignee: { kind: "person", name: "Bob" }, due_on: "2026-10-01" },
    });
    expect(payload.text).toMatch(/^T-12 Ship the launch post was finished by Priya · https:\/\/chat\.example\.com\//);

    for (const [request, secret] of [
      [slack, "slack-secret"],
      [json, "json-secret"],
    ] as const) {
      const timestamp = request.headers["X-Maeosan-Timestamp"];
      const expected = `sha256=${createHmac("sha256", secret).update(`${timestamp}.${request.body}`).digest("hex")}`;
      expect(request.headers["X-Maeosan-Signature"]).toBe(expected);
      expect(request.headers["X-Maeosan-Event"]).toBe("task.completed");
    }
    expect(deliveries).toEqual(expect.arrayContaining([{ id: "hook-slack", status: 200 }, { id: "hook-json", status: 200 }]));
  });

  it("never calls a private address, and records it as unreachable", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { deliverTaskEvent } = await load();
    const { admin, deliveries } = fakeAdmin([{ id: "hook-internal", name: "Internal", url: "https://10.0.0.8/hook", format: "json", secret: "s" }]);

    await deliverTaskEvent(admin, { event: "task.completed", taskId: "task-1", actorName: "Priya" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(deliveries).toEqual([{ id: "hook-internal", status: 0 }]);
  });

  it("does nothing when no webhook listens for the event", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const { deliverTaskEvent } = await load();
    const { admin, deliveries } = fakeAdmin([]);

    expect(await deliverTaskEvent(admin, { event: "task.updated", taskId: "task-1", actorName: "Priya" })).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(deliveries).toEqual([]);
  });
});
