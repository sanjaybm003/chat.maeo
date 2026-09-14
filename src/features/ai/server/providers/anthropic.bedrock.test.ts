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
 * API key as a bearer token, Bedrock model ids, the plain Messages API with no
 * beta fields, and recovery from refused keys and refused models.
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

const apiError = (response: ServerResponse, status: number, type: string, message: string) =>
  json(response, status, { type: "error", error: { type, message } });

const refuse = (response: ServerResponse) => apiError(response, 403, "permission_error", "Not allowed");

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

function sse(response: ServerResponse, events: Array<[string, unknown]>) {
  response.writeHead(200, { "content-type": "text/event-stream" });
  for (const [event, data] of events) response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  response.end();
}

const finish = (stopReason: string): Array<[string, unknown]> => [
  ["message_delta", { type: "message_delta", delta: { stop_reason: stopReason, stop_sequence: null }, usage: { output_tokens: 8 } }],
  ["message_stop", { type: "message_stop" }],
];

function streamText(response: ServerResponse, model: string, text: string) {
  sse(response, [
    ["message_start", { type: "message_start", message: message(model, [], null) }],
    ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } }],
    ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text } }],
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    ...finish("end_turn"),
  ]);
}

const toolResult = (model: string, name: string) =>
  message(model, [{ type: "tool_use", id: "toolu_1", name: "submit_result", input: { name } }], "tool_use");

const load = async () => (await import("./anthropic")).anthropicProvider;
const paths = () => seen.map((request) => request.url.split("?")[0]);
const signal = () => new AbortController().signal;

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
const memberTool = { name: "list_workspace_members", description: "List members", parameters: { type: "object" as const, properties: {} } };

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
  for (const name of ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "AWS_BEARER_TOKEN_BEDROCK", "CLAUDE_HOST", "BEDROCK_ENDPOINT", "GEMINI_API_KEY", "OPENAI_API_KEY", "DEEPSEEK_API_KEY"]) {
    vi.stubEnv(name, "");
  }
  vi.stubEnv("BEDROCK_API_KEY", "test-bedrock-key");
  vi.stubEnv("BEDROCK_REGION", "us-west-2");
  vi.stubEnv("ANTHROPIC_BEDROCK_MANTLE_BASE_URL", `${origin}/mantle`);
  vi.stubEnv("ANTHROPIC_BEDROCK_BASE_URL", `${origin}/runtime`);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("Claude on Amazon Bedrock", () => {
  it("streams a reply through the plain Messages API with the API key, without Anthropic-only features", async () => {
    respond = (_request, response) => streamText(response, "anthropic.claude-opus-5", "Hello team");
    const provider = await load();
    const session = provider.createSession({
      model: opus,
      system: "You help the team.",
      userMessage: "Hi",
      tools: [memberTool],
      webSearch: true,
      maxOutputTokens: 1000,
      temperature: 0.5,
    });

    const deltas: string[] = [];
    const result = await session.step({ signal: signal(), onText: (delta) => deltas.push(delta) });

    expect(result).toMatchObject({ text: "Hello team", outcome: "done", toolCalls: [] });
    expect(result.billedModel).toBeUndefined();
    expect(result.usage).toMatchObject({ inputTokens: 120, outputTokens: 8 });
    expect(deltas.join("")).toBe("Hello team");

    const [request] = seen;
    expect(request.url).toBe("/mantle/v1/messages");
    expect(request.headers.authorization).toBe("Bearer test-bedrock-key");
    expect(request.headers["anthropic-beta"]).toBeUndefined();
    expect(request.body).toMatchObject({ model: "anthropic.claude-opus-5", stream: true, max_tokens: 1000 });
    expect(request.body).not.toHaveProperty("fallbacks");
    expect(request.body).not.toHaveProperty("temperature");
    expect(request.body.tools).toEqual([{ name: "list_workspace_members", description: "List members", input_schema: { type: "object", properties: {} } }]);
  });

  it("sends earlier turns back with core fields only, dropping beta-only ones", async () => {
    let call = 0;
    respond = (_request, response) => {
      call += 1;
      if (call === 2) return streamText(response, "anthropic.claude-sonnet-5", "Sam is here.");
      sse(response, [
        ["message_start", { type: "message_start", message: message("anthropic.claude-sonnet-5", [], null) }],
        ["content_block_start", { type: "content_block_start", index: 0, content_block: { type: "text", text: "", citations: null } }],
        ["content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "Let me check." } }],
        ["content_block_stop", { type: "content_block_stop", index: 0 }],
        [
          "content_block_start",
          { type: "content_block_start", index: 1, content_block: { type: "tool_use", id: "toolu_9", name: "list_workspace_members", input: {}, caller: { type: "direct" } } },
        ],
        ["content_block_delta", { type: "content_block_delta", index: 1, delta: { type: "input_json_delta", partial_json: "{}" } }],
        ["content_block_stop", { type: "content_block_stop", index: 1 }],
        ...finish("tool_use"),
      ]);
    };
    const provider = await load();
    const session = provider.createSession({
      model: sonnet,
      system: "You help the team.",
      userMessage: "Who is here?",
      tools: [memberTool],
      webSearch: false,
      maxOutputTokens: 1000,
    });

    const first = await session.step({ signal: signal(), onText: () => undefined });
    expect(first).toMatchObject({ outcome: "tool_calls", toolCalls: [{ id: "toolu_9", name: "list_workspace_members" }] });
    session.addToolResults([{ callId: "toolu_9", name: "list_workspace_members", output: "- Sam" }]);
    await session.step({ signal: signal(), onText: () => undefined });

    expect(seen[1].body.messages).toEqual([
      { role: "user", content: "Who is here?" },
      {
        role: "assistant",
        content: [
          { type: "text", text: "Let me check." },
          { type: "tool_use", id: "toolu_9", name: "list_workspace_members", input: {} },
        ],
      },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_9", content: "- Sam" }] },
    ]);
  });

  it("returns structured results as a tool call, since Bedrock has no structured outputs", async () => {
    respond = (_request, response) => json(response, 200, toolResult("anthropic.claude-sonnet-5", "Scout"));
    const provider = await load();

    const result = await provider.generateObject(structuredRequest);

    expect(result.value).toEqual({ name: "Scout" });
    const [request] = seen;
    expect(request.url).toBe("/mantle/v1/messages");
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

  it("uses the next available Claude model when the account can't use the chosen one, and bills that model", async () => {
    respond = (request, response) =>
      request.body.model === "anthropic.claude-opus-5"
        ? apiError(response, 404, "not_found_error", "Model anthropic.claude-opus-5 is not available for this account")
        : json(response, 200, toolResult(String(request.body.model), "Atlas"));
    const provider = await load();

    const result = await provider.generateObject({ ...structuredRequest, model: opus });
    expect(result.value).toEqual({ name: "Atlas" });
    expect(result.model).toMatchObject({ id: "claude-sonnet-5", inputPrice: 2.2 });
    expect(seen.map((request) => request.body.model)).toEqual(["anthropic.claude-opus-5", "anthropic.claude-sonnet-5"]);

    seen.length = 0;
    await provider.generateObject({ ...structuredRequest, model: opus });
    expect(seen.map((request) => request.body.model)).toEqual(["anthropic.claude-sonnet-5"]);
  });

  it("says AI is unavailable, listing every model tried, when the account can't use any Claude model", async () => {
    respond = (request, response) =>
      apiError(
        response,
        403,
        "permission_error",
        `${String(request.body.model)} is not available for this account. You can explore other available models on Amazon Bedrock.`,
      );
    const provider = await load();

    await expect(provider.generateObject({ ...structuredRequest, model: findModel("claude-haiku-4-5")! })).rejects.toMatchObject({
      kind: "unavailable",
      message: "AI isn’t available right now. Try again soon.",
      detail: expect.stringMatching(
        /^Tried Claude Haiku 4\.5, Claude Opus 5, Claude Sonnet 5\. 403 anthropic\.claude-sonnet-5 is not available for this account/,
      ),
    });
    expect(seen.map((request) => request.body.model)).toEqual(["anthropic.claude-haiku-4-5", "anthropic.claude-opus-5", "anthropic.claude-sonnet-5"]);
    expect(paths().every((path) => path.startsWith("/mantle"))).toBe(true);
  });

  it("switches to the runtime endpoint when the Messages endpoint refuses the key, and stays there", async () => {
    respond = (request, response) =>
      request.url.startsWith("/mantle") ? refuse(response) : json(response, 200, toolResult("claude-sonnet-5", "Atlas"));
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

  it("shows a plain message, keeping Bedrock's reason for the run record, when both endpoints refuse", async () => {
    respond = (_request, response) => refuse(response);
    const provider = await load();

    await expect(provider.generateObject(structuredRequest)).rejects.toMatchObject({
      name: "ProviderError",
      kind: "auth",
      message: "AI isn’t available right now. Try again soon.",
      detail: expect.stringContaining("403"),
    });
    expect(paths()).toEqual(["/mantle/v1/messages", "/runtime/model/global.anthropic.claude-sonnet-5/invoke"]);
  });

  it("reports an invalid request with Bedrock's reason attached", async () => {
    respond = (_request, response) => apiError(response, 400, "invalid_request_error", "messages: roles must alternate");
    const provider = await load();

    await expect(provider.generateObject(structuredRequest)).rejects.toMatchObject({
      kind: "bad_request",
      message: "The AI couldn’t process that request.",
      detail: expect.stringContaining("roles must alternate"),
    });
    expect(seen).toHaveLength(1);
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
    respond = (_request, response) => json(response, 200, toolResult("anthropic.claude-sonnet-5", "Relay"));
    const provider = await load();

    expect((await provider.generateObject(structuredRequest)).value).toEqual({ name: "Relay" });
    expect(paths()).toEqual(["/mantle/v1/messages"]);
    expect(seen[0].headers.authorization).toBe("Bearer bedrock-api-key-test");
    expect(seen[0].body).toMatchObject({ model: "anthropic.claude-sonnet-5" });
  });
});
