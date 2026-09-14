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
 * Open models on Amazon Bedrock through its OpenAI-compatible Chat Completions
 * API, driven against a local stand-in for the bedrock-mantle endpoint.
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

function chunks(response: ServerResponse, model: string, parts: Array<Record<string, unknown>>) {
  response.writeHead(200, { "content-type": "text/event-stream" });
  for (const part of parts) {
    response.write(`data: ${JSON.stringify({ id: "chatcmpl-1", object: "chat.completion.chunk", created: 1, model, ...part })}\n\n`);
  }
  response.write("data: [DONE]\n\n");
  response.end();
}

const textReply = (response: ServerResponse, model: string, text: string) =>
  chunks(response, model, [
    { choices: [{ index: 0, delta: { role: "assistant", content: text }, finish_reason: "stop" }] },
    { choices: [], usage: { prompt_tokens: 50, completion_tokens: 4, total_tokens: 54 } },
  ]);

const deepseek = findModel("deepseek.v3.2")!;
const gptOss = findModel("openai.gpt-oss-120b")!;
const memberTool = { name: "list_workspace_members", description: "List members", parameters: { type: "object" as const, properties: {} } };

const load = async () => ({
  provider: (await import("./openai-compatible")).bedrockProvider,
  env: await import("../env"),
});

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
  for (const name of ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "AWS_BEARER_TOKEN_BEDROCK", "CLAUDE_HOST", "GEMINI_API_KEY", "OPENAI_API_KEY", "DEEPSEEK_API_KEY"]) {
    vi.stubEnv(name, "");
  }
  vi.stubEnv("BEDROCK_API_KEY", "test-bedrock-key");
  vi.stubEnv("BEDROCK_REGION", "us-east-1");
  vi.stubEnv("BEDROCK_OPENAI_BASE_URL", `${origin}/v1`);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("open models on Amazon Bedrock", () => {
  it("streams a reply with the Bedrock key, never asking for more than the model can write", async () => {
    respond = (_request, response) => textReply(response, "deepseek.v3.2", "Hello team");
    const { provider } = await load();
    const session = provider.createSession({
      model: deepseek,
      system: "You help the team.",
      userMessage: "Hi",
      tools: [memberTool],
      webSearch: false,
      maxOutputTokens: 12_000,
      temperature: 0.3,
    });

    const deltas: string[] = [];
    const result = await session.step({ signal: new AbortController().signal, onText: (delta) => deltas.push(delta) });

    expect(result).toMatchObject({ text: "Hello team", outcome: "done", toolCalls: [], usage: { inputTokens: 50, outputTokens: 4 } });
    expect(deltas.join("")).toBe("Hello team");
    const [request] = seen;
    expect(request.url).toBe("/v1/chat/completions");
    expect(request.headers.authorization).toBe("Bearer test-bedrock-key");
    expect(request.body).toMatchObject({
      model: "deepseek.v3.2",
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: 8_000,
      temperature: 0.3,
    });
    expect((request.body.tools as Array<{ function: { name: string } }>)[0].function.name).toBe("list_workspace_members");
  });

  it("carries tool calls and their results through the conversation", async () => {
    let call = 0;
    respond = (_request, response) => {
      call += 1;
      if (call === 2) return textReply(response, "openai.gpt-oss-120b", "Sam is here.");
      chunks(response, "openai.gpt-oss-120b", [
        {
          choices: [
            {
              index: 0,
              delta: { role: "assistant", tool_calls: [{ index: 0, id: "call_1", type: "function", function: { name: "list_workspace_members", arguments: "{}" } }] },
              finish_reason: "tool_calls",
            },
          ],
        },
      ]);
    };
    const { provider } = await load();
    const session = provider.createSession({ model: gptOss, system: "You help.", userMessage: "Who is here?", tools: [memberTool], webSearch: false, maxOutputTokens: 1000, temperature: 0.4 });

    const first = await session.step({ signal: new AbortController().signal, onText: () => undefined });
    expect(first).toMatchObject({ outcome: "tool_calls", toolCalls: [{ id: "call_1", name: "list_workspace_members", input: {} }] });
    session.addToolResults([{ callId: "call_1", name: "list_workspace_members", output: "- Sam" }]);
    const second = await session.step({ signal: new AbortController().signal, onText: () => undefined });

    expect(second.text).toBe("Sam is here.");
    expect(seen[0].body).not.toHaveProperty("temperature");
    expect((seen[1].body.messages as unknown[]).slice(2)).toEqual([
      { role: "assistant", content: null, tool_calls: [{ id: "call_1", type: "function", function: { name: "list_workspace_members", arguments: "{}" } }] },
      { role: "tool", tool_call_id: "call_1", content: "- Sam" },
    ]);
  });

  it("drafts structured results without response_format, reading the JSON from the reply", async () => {
    respond = (_request, response) =>
      json(response, 200, {
        id: "chatcmpl-2",
        object: "chat.completion",
        created: 1,
        model: "openai.gpt-oss-120b",
        choices: [{ index: 0, message: { role: "assistant", content: '```json\n{"name":"Scout"}\n```' }, finish_reason: "stop" }],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      });
    const { provider } = await load();

    const result = await provider.generateObject({
      model: gptOss,
      system: "Design an agent.",
      prompt: "Release notes",
      jsonSchema: { type: "object", properties: { name: { type: "string" } } },
      parse: (value) => value as { name: string },
      maxOutputTokens: 500,
    });

    expect(result.value).toEqual({ name: "Scout" });
    expect(seen[0].body).not.toHaveProperty("response_format");
    expect(seen[0].body).toMatchObject({ model: "openai.gpt-oss-120b", max_tokens: 500 });
  });

  it("keeps inline reasoning out of the chat, even when a tag is split across chunks", async () => {
    const { ReasoningFilter } = await import("./openai-compatible");
    const filter = new ReasoningFilter();
    const parts = ["Hel", "lo <thi", "nk>secret</th", "ink> world", " <reas"].map((chunk) => filter.push(chunk));
    expect(parts.join("") + filter.flush()).toBe("Hello  world <reas");

    respond = (_request, response) =>
      chunks(response, "openai.gpt-oss-120b", [
        { choices: [{ index: 0, delta: { role: "assistant", content: "<reasoning>The user wants" }, finish_reason: null }] },
        { choices: [{ index: 0, delta: { content: " a greeting.</reasoning>\n\nHi Sam" }, finish_reason: "stop" }] },
      ]);
    const { provider } = await load();
    const deltas: string[] = [];
    const result = await provider
      .createSession({ model: gptOss, system: "s", userMessage: "u", tools: [], webSearch: false, maxOutputTokens: 100 })
      .step({ signal: new AbortController().signal, onText: (delta) => deltas.push(delta) });

    expect(result.text).toBe("Hi Sam");
    expect(deltas.join("")).toBe("Hi Sam");
  });

  it("marks a model the account can't use so routing steers around it", async () => {
    respond = (_request, response) =>
      json(response, 403, { error: { message: "deepseek.v3.2 is not available for this account", type: "permission_error" } });
    const { provider, env } = await load();

    await expect(
      provider.createSession({ model: deepseek, system: "s", userMessage: "u", tools: [], webSearch: false, maxOutputTokens: 100 }).step({
        signal: new AbortController().signal,
        onText: () => undefined,
      }),
    ).rejects.toMatchObject({
      kind: "unavailable",
      message: "AI isn’t available right now. Try again soon.",
      detail: expect.stringContaining("not available for this account"),
    });

    const ids = env.configuredModels().map((model) => model.id);
    expect(ids).not.toContain("deepseek.v3.2");
    expect(ids).toContain("openai.gpt-oss-120b");
  });
});
