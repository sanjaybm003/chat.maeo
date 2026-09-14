import { createServer, type IncomingHttpHeaders, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { findModel } from "../../models";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => {
  const quiet = { debug() {}, info() {}, warn() {}, error() {}, child: () => quiet };
  return { logger: quiet };
});

/**
 * Drives the Claude adapter against a local stand-in for Amazon Bedrock, using
 * the SDK's base-URL overrides, to prove what goes over the wire: the Bedrock
 * API key as a bearer token, Bedrock model ids, no Anthropic-only features,
 * and the switch to the runtime endpoint when the Messages endpoint refuses a key.
 */

interface Seen {
  url: string;
  headers: IncomingHttpHeaders;
  body: Record<string, unknown>;
}

const seen: Seen[] = [];
let respond: (request: Seen, response: ServerResponse) => void = () => undefined;
let server: Server;
let origin = "";

const json = (response: ServerResponse, status: number, body: unknown) => {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
};

const refuse = (response: ServerResponse) =>
  json(response, 403, { type: "error", error: { type: "permission_error", message: "Not allowed" } });

const message = (model: string, content: unknown[], stopReason: string | null) => ({
  id: "msg_test",
  type: "message",
  role: "assistant",
  model,
  content,
  stop_reason: stopReason,
  stop_sequence: null,
  usage: { input_tokens: 120, output_tokens: 8 },
});

function streamText(response: ServerResponse, model: string, text: string) {
  const events: Array<[string, unknown]> = [
    ["message_start", { type: "message_start", message: message(model, [], null) }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ["message_delta", { type: "message_delta", delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 8 } }],
    ["message_stop", { type: "message_stop" }],
  ];
  response.writeHead(200, { "content-type": "text/event-stream" });
  for (const [event, data] of events) response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  response.end();
}

const load = async () => (await import("./anthropic")).anthropicProvider;
const paths = () => seen.map((request) => request.url.split("?")[0]);

const opus = findModel("claude-opus-5")!;
const sonnet = findModel("claude-sonnet-5")!;
const schema = { type: "object", properties: { name: { type: "string" } }, required: ["name"] };
const structuredRequest = {
  model: sonnet,
  system: "Design an agent.",
  prompt: "An agent that writes release notes",
  jsonSchema: schema,
  parse: (value: unknown) => value as { name: string },
  maxOutputTokens: 500,
};

beforeAll(async () => {
  server = createServer((request, response) => {
    let raw = "";
    request.on("data", (chunk) => (raw += chunk));
    request.on("end", () => {
      const entry: Seen = { url: request.url ?? "", headers: request.headers, body: raw ? JSON.parse(raw) : {} };
      seen.push(entry);
      respond(entry, response);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

beforeEach(() => {
  seen.length = 0;
  vi.resetModules();
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("ANTHROPIC_BASE_URL", "");
  vi.stubEnv("AWS_BEARER_TOKEN_BEDROCK", "");
  vi.stubEnv("CLAUDE_HOST", "");
  vi.stubEnv("BEDROCK_ENDPOINT", "");
  vi.stubEnv("BEDROCK_API_KEY", "test-bedrock-key");
  vi.stubEnv("BEDROCK_REGION", "us-west-2");
  vi.stubEnv("ANTHROPIC_BEDROCK_MANTLE_BASE_URL", `${origin}/mantle`);
  vi.stubEnv("ANTHROPIC_BEDROCK_BASE_URL", `${origin}/runtime`);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Claude on Amazon Bedrock", () => {
  it("streams a reply through the Messages endpoint with the API key, without Anthropic-only features", async () => {
    respond = (_request, response) => streamText(response, "anthropic.claude-opus-5", "Hello team");
    const provider = await load();
    const session = provider.createSession({
      model: opus,
      system: "You help the team.",
      userMessage: "Hi",
      tools: [{ name: "list_workspace_members", description: "List members", parameters: { type: "object", properties: {}, required: [] } }],
      webSearch: true,
      maxOutputTokens: 1000,
      temperature: 0.5,
    });

    const deltas: string[] = [];
    const result = await session.step({ signal: new AbortController().signal, onText: (delta) => deltas.push(delta) });

    expect(result).toMatchObject({ text: "Hello team", outcome: "done", toolCalls: [] });
    expect(result.usage).toMatchObject({ inputTokens: 120, outputTokens: 8 });
    expect(deltas.join("")).toBe("Hello team");
    expect(paths()).toEqual(["/mantle/v1/messages"]);

    const [request] = seen;
    expect(request.headers.authorization).toBe("Bearer test-bedrock-key");
    expect(request.headers["anthropic-beta"]).toBeUndefined();
    expect(request.body).toMatchObject({ model: "anthropic.claude-opus-5", stream: true, max_tokens: 1000 });
    expect(request.body).not.toHaveProperty("fallbacks");
    expect(request.body).not.toHaveProperty("temperature");
    expect((request.body.tools as Array<{ name: string }>).map((tool) => tool.name)).toEqual(["list_workspace_members"]);
  });

  it("returns structured results as a tool call, since Bedrock has no structured outputs", async () => {
    respond = (_request, response) =>
      json(response, 200, message("anthropic.claude-sonnet-5", [{ type: "tool_use", id: "toolu_1", name: "submit_result", input: { name: "Scout" } }], "tool_use"));
    const provider = await load();

    const result = await provider.generateObject(structuredRequest);

    expect(result.value).toEqual({ name: "Scout" });
    const [request] = seen;
    expect(request.body).not.toHaveProperty("output_config");
    expect((request.body.tools as Array<Record<string, unknown>>)[0]).toMatchObject({ name: "submit_result", input_schema: schema });
    expect(request.body.system).toMatch(/submit_result/);
  });

  it("reads the JSON from text when the model answers without calling the tool", async () => {
    respond = (_request, response) =>
      json(response, 200, message("anthropic.claude-sonnet-5", [{ type: "text", text: 'Here it is: {"name":"Quill"}' }], "end_turn"));
    const provider = await load();

    expect((await provider.generateObject(structuredRequest)).value).toEqual({ name: "Quill" });
  });

  it("switches to the runtime endpoint when the Messages endpoint refuses the key, and stays there", async () => {
    respond = (request, response) =>
      request.url.startsWith("/mantle")
        ? refuse(response)
        : json(response, 200, message("claude-sonnet-5", [{ type: "tool_use", id: "toolu_2", name: "submit_result", input: { name: "Atlas" } }], "tool_use"));
    const provider = await load();

    expect((await provider.generateObject(structuredRequest)).value).toEqual({ name: "Atlas" });
    expect(paths()).toEqual(["/mantle/v1/messages", "/runtime/model/global.anthropic.claude-sonnet-5/invoke"]);

    const runtime = seen[1];
    expect(runtime.headers.authorization).toBe("Bearer test-bedrock-key");
    expect(runtime.body).not.toHaveProperty("model");
    expect(runtime.body.anthropic_version).toEqual(expect.any(String));

    seen.length = 0;
    await provider.generateObject(structuredRequest);
    expect(paths()).toEqual(["/runtime/model/global.anthropic.claude-sonnet-5/invoke"]);
  });

  it("shows a plain message, never key details, when both endpoints refuse", async () => {
    respond = (_request, response) => refuse(response);
    const provider = await load();

    await expect(provider.generateObject(structuredRequest)).rejects.toMatchObject({
      name: "ProviderError",
      kind: "auth",
      message: "AI isn’t available right now. Try again soon.",
    });
    expect(paths()).toEqual(["/mantle/v1/messages", "/runtime/model/global.anthropic.claude-sonnet-5/invoke"]);
  });

  it("doesn't try the other endpoint when one is pinned", async () => {
    vi.stubEnv("BEDROCK_ENDPOINT", "mantle");
    respond = (_request, response) => refuse(response);
    const provider = await load();

    await expect(provider.generateObject(structuredRequest)).rejects.toMatchObject({ kind: "auth" });
    expect(paths()).toEqual(["/mantle/v1/messages"]);
  });

  it("understands Claude Code's layout: a Bedrock key in ANTHROPIC_API_KEY with Bedrock's base URL", async () => {
    vi.stubEnv("BEDROCK_API_KEY", "");
    vi.stubEnv("BEDROCK_REGION", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "bedrock-api-key-test");
    vi.stubEnv("ANTHROPIC_BASE_URL", "https://bedrock-mantle.us-east-1.api.aws/anthropic");
    respond = (_request, response) =>
      json(response, 200, message("anthropic.claude-sonnet-5", [{ type: "tool_use", id: "toolu_3", name: "submit_result", input: { name: "Relay" } }], "tool_use"));
    const provider = await load();

    expect((await provider.generateObject(structuredRequest)).value).toEqual({ name: "Relay" });
    expect(paths()).toEqual(["/mantle/v1/messages"]);
    expect(seen[0].headers.authorization).toBe("Bearer bedrock-api-key-test");
    expect(seen[0].body).toMatchObject({ model: "anthropic.claude-sonnet-5" });
    expect(seen[0].body).not.toHaveProperty("output_config");
  });
});
