import "server-only";

import { AnthropicBedrock, AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import Anthropic from "@anthropic-ai/sdk";

import { logger } from "@/lib/logger";

import { bedrockModelId, type BedrockEndpoint, type ClaudeHost } from "../../claude-hosts";
import type { AiModel } from "../../models";
import { aiEnv, configuredModels } from "../env";
import {
  ProviderError,
  type AiProviderClient,
  type ProviderErrorKind,
  type ProviderSession,
  type SessionOptions,
  type StepHooks,
  type StepOutcome,
  type StepResult,
  type StepUsage,
  type StructuredRequest,
  type ToolCall,
  type ToolResult,
} from "./types";

/**
 * Claude, on Anthropic's API or on Amazon Bedrock. Both speak the Messages API,
 * so one session serves either; the differences are the client, the model ids,
 * and features Bedrock doesn't offer (web search, server-side fallbacks,
 * structured outputs, beta request fields).
 */

/**
 * Server-side refusal fallbacks (Anthropic's API only): when a model's safety
 * classifiers decline a request, Anthropic re-runs it on its recommended
 * fallback model in the same call instead of returning a refusal.
 */
const SERVER_FALLBACK_MODELS = new Set(["claude-opus-5"]);
const SERVER_FALLBACK_BETA = "server-side-fallback-2026-07-01";
const WEB_SEARCH_MAX_USES = 3;
const RESULT_TOOL = "submit_result";
/** A model Bedrock refused is skipped for this long, then tried again in case access was granted. */
const REFUSED_MODEL_TTL_MS = 10 * 60 * 1000;

const UNAVAILABLE = "AI isn’t available right now. Try again soon.";

const log = logger.child({ module: "claude" });

type MessagesApi = Pick<Anthropic["beta"]["messages"], "create" | "stream">;

interface ClaudeBackend {
  host: ClaudeHost;
  endpoint: "api" | BedrockEndpoint;
  messages: MessagesApi;
  modelId: (model: AiModel) => string;
}

let anthropicMessages: MessagesApi | null = null;
const bedrockMessages: Partial<Record<BedrockEndpoint, MessagesApi>> = {};
/** Set once the runtime endpoint has worked for a key the Messages endpoint refused. */
let preferRuntime = false;
/** "<endpoint>:<model id>" → when to try that model on that endpoint again. */
const refusedModels = new Map<string, number>();

function bedrockBackend(endpoint: BedrockEndpoint): ClaudeBackend {
  const apiKey = aiEnv.bedrockKey ?? undefined;
  const awsRegion = aiEnv.bedrockRegion;
  // The plain Messages API: Bedrock has no use for ?beta=true or beta-only request fields.
  bedrockMessages[endpoint] ??= (
    endpoint === "mantle"
      ? new AnthropicBedrockMantle({ apiKey, awsRegion }).messages
      : new AnthropicBedrock({ apiKey, awsRegion }).messages
  ) as unknown as MessagesApi;
  return {
    host: "bedrock",
    endpoint,
    messages: bedrockMessages[endpoint],
    modelId: (model) => bedrockModelId(model.id, endpoint),
  };
}

function backend(): ClaudeBackend {
  switch (aiEnv.claudeHost) {
    case "anthropic":
      anthropicMessages ??= new Anthropic({ apiKey: aiEnv.anthropicKey ?? undefined }).beta.messages;
      return { host: "anthropic", endpoint: "api", messages: anthropicMessages, modelId: (model) => model.id };
    case "bedrock":
      return bedrockBackend(aiEnv.bedrockEndpoint ?? (preferRuntime ? "runtime" : "mantle"));
    default:
      log.error("Claude isn't configured: set ANTHROPIC_API_KEY or BEDROCK_API_KEY");
      throw new ProviderError("not_configured", "anthropic", UNAVAILABLE);
  }
}

const detailOf = (error: unknown) =>
  (error instanceof Anthropic.APIError
    ? `${error.status ?? ""} ${error.message}`
    : error instanceof Error
      ? error.message
      : String(error)
  )
    .trim()
    .slice(0, 400);

const MODEL_PROBLEM = /\bmodels?\b|identifier|inference profile|throughput|not (?:currently )?(?:available|supported|enabled)|access to/i;

/** Bedrock turns away a model the account can't use with a 404, or a 400/403 that names the model. */
function isModelRefused(error: unknown) {
  if (error instanceof Anthropic.NotFoundError) return true;
  return (error instanceof Anthropic.BadRequestError || error instanceof Anthropic.PermissionDeniedError) && MODEL_PROBLEM.test(error.message);
}

const isCredentialRefused = (error: unknown) =>
  (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) && !isModelRefused(error);

const refusedKey = (active: ClaudeBackend, model: AiModel) => `${active.endpoint}:${model.id}`;
const isRefused = (active: ClaudeBackend, model: AiModel) => (refusedModels.get(refusedKey(active, model)) ?? 0) > Date.now();

/** The other Claude models this server can use, the next cheaper ones first. */
function alternativesTo(model: AiModel): AiModel[] {
  const claude = configuredModels().filter((item) => item.provider === "anthropic");
  const index = claude.findIndex((item) => item.id === model.id);
  return index === -1 ? claude : [...claude.slice(index + 1), ...claude.slice(0, index)];
}

function describe(active: ClaudeBackend) {
  return active.host === "bedrock" ? `Bedrock ${active.endpoint} endpoint in ${aiEnv.bedrockRegion}` : "Anthropic API";
}

function bedrockHint() {
  const expiresAt = aiEnv.bedrockKeyExpiresAt;
  if (expiresAt && expiresAt.getTime() <= Date.now()) {
    return `The Bedrock API key is a short-term key that expired at ${expiresAt.toISOString()}. Create a long-term Amazon Bedrock API key for the server.`;
  }
  return "Check the Bedrock API key and region, and that Claude model access is enabled in the Bedrock console for that account.";
}

function fail(kind: ProviderErrorKind, message: string, error: unknown): never {
  throw new ProviderError(kind, "anthropic", message, detailOf(error));
}

/** Details stay in the server log and the asker's private run record; the chat gets a plain message. */
function translateError(error: unknown, active: ClaudeBackend): never {
  if (error instanceof Anthropic.APIUserAbortError || error instanceof ProviderError) throw error;
  if (isModelRefused(error)) {
    log.error(`${describe(active)} refused every Claude model it was offered`, { hint: bedrockHint(), error });
    fail("bad_request", "This model isn’t available right now. Try another model.", error);
  }
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    log.error(`${describe(active)} refused the credentials`, {
      status: error.status,
      hint: active.host === "bedrock" ? bedrockHint() : "Check ANTHROPIC_API_KEY.",
      error,
    });
    fail("auth", UNAVAILABLE, error);
  }
  if (error instanceof Anthropic.RateLimitError) {
    log.warn(`${describe(active)} rate limited the request`, { error });
    fail("rate_limited", "AI is busy right now. Try again in a moment.", error);
  }
  if (error instanceof Anthropic.BadRequestError) {
    log.warn(`${describe(active)} rejected the request`, { error });
    fail("bad_request", "The AI couldn’t process that request.", error);
  }
  if (error instanceof Anthropic.InternalServerError) {
    fail("overloaded", "AI had a temporary problem. Try again in a moment.", error);
  }
  if (error instanceof Anthropic.APIConnectionError) {
    log.warn(`Couldn't reach the ${describe(active)}`, { error });
    fail("network", "Couldn’t reach the AI service. Try again in a moment.", error);
  }
  throw error;
}

/**
 * Runs a call, recovering from what Bedrock accounts commonly hit:
 *   • a key the Messages endpoint refuses → the runtime endpoint, kept once it works
 *   • a model the account can't use (Opus often needs separate access) → the next
 *     available Claude model, remembered for a few minutes so later calls skip it
 * Only retries while nothing has reached the chat yet. Returns the model that answered.
 */
async function withBackend<T>(
  model: AiModel,
  run: (active: ClaudeBackend, model: AiModel) => Promise<T>,
  canRetry: () => boolean,
): Promise<{ result: T; model: AiModel }> {
  let active = backend();
  let current = model;
  if (active.host === "bedrock" && isRefused(active, current)) {
    current = alternativesTo(current).find((item) => !isRefused(active, item)) ?? current;
  }
  const tried = new Set<string>();
  let switchedEndpoint = false;

  for (;;) {
    tried.add(`${active.endpoint}:${current.id}`);
    try {
      const result = await run(active, current);
      if (switchedEndpoint && !preferRuntime) {
        preferRuntime = true;
        log.warn("Bedrock Messages endpoint refused this key; using the Bedrock runtime endpoint");
      }
      return { result, model: current };
    } catch (error) {
      if (active.host !== "bedrock" || !canRetry()) translateError(error, active);

      if (isCredentialRefused(error) && active.endpoint === "mantle" && !aiEnv.bedrockEndpoint && !switchedEndpoint) {
        log.warn("Bedrock Messages endpoint refused the credentials; trying the runtime endpoint", { detail: detailOf(error) });
        switchedEndpoint = true;
        active = bedrockBackend("runtime");
        continue;
      }

      if (isModelRefused(error)) {
        if (!isRefused(active, current)) {
          log.warn(`${describe(active)} refused ${current.label}; using another Claude model for now`, { detail: detailOf(error) });
        }
        refusedModels.set(refusedKey(active, current), Date.now() + REFUSED_MODEL_TTL_MS);
        const next = alternativesTo(current).find((item) => !tried.has(`${active.endpoint}:${item.id}`) && !isRefused(active, item));
        if (next) {
          current = next;
          continue;
        }
      }

      translateError(error, active);
    }
  }
}

function fallbackParams(active: ClaudeBackend, model: AiModel) {
  return active.host === "anthropic" && SERVER_FALLBACK_MODELS.has(model.id)
    ? { betas: [SERVER_FALLBACK_BETA], fallbacks: "default" as const }
    : {};
}

function webSearchTool(model: AiModel): Anthropic.Beta.BetaToolUnion | null {
  switch (model.webSearch) {
    case "anthropic-dynamic":
      return { type: "web_search_20260209", name: "web_search", max_uses: WEB_SEARCH_MAX_USES };
    case "anthropic-basic":
      return { type: "web_search_20250305", name: "web_search", max_uses: WEB_SEARCH_MAX_USES };
    default:
      return null;
  }
}

function usageOf(message: Anthropic.Beta.BetaMessage): StepUsage {
  const usage = message.usage;
  return {
    inputTokens: usage.input_tokens,
    outputTokens: usage.output_tokens,
    cacheReadTokens: usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: usage.cache_creation_input_tokens ?? 0,
    webSearches: usage.server_tool_use?.web_search_requests ?? 0,
  };
}

function outcomeOf(stopReason: string | null, toolCalls: number): StepOutcome {
  switch (stopReason) {
    case "tool_use":
      return toolCalls > 0 ? "tool_calls" : "done";
    case "pause_turn":
      return "continue";
    case "max_tokens":
      return "max_tokens";
    case "refusal":
      return "refused";
    default:
      return "done";
  }
}

/**
 * After a fallback switched models mid-answer, only text from before the last
 * switch point may be sent back; blocks after it echo normally.
 */
function echoableContent(content: Anthropic.Beta.BetaContentBlock[]): Anthropic.Beta.BetaContentBlock[] {
  const boundary = content.map((block) => block.type).lastIndexOf("fallback");
  if (boundary === -1) return content;
  return content.filter((block, index) => index > boundary || block.type === "text");
}

/** What Bedrock is sent back: each block's core fields only, never beta-only ones like `caller`. */
function plainContent(content: Anthropic.Beta.BetaContentBlock[]): Anthropic.Beta.BetaContentBlockParam[] {
  return content.flatMap((block): Anthropic.Beta.BetaContentBlockParam[] => {
    switch (block.type) {
      case "text":
        return block.text ? [{ type: "text", text: block.text }] : [];
      case "tool_use":
        return [{ type: "tool_use", id: block.id, name: block.name, input: block.input ?? {} }];
      case "thinking":
        return [{ type: "thinking", thinking: block.thinking, signature: block.signature }];
      case "redacted_thinking":
        return [{ type: "redacted_thinking", data: block.data }];
      default:
        return [];
    }
  });
}

const textOf = (content: Anthropic.Beta.BetaContentBlock[]) =>
  content
    .filter((block): block is Anthropic.Beta.BetaTextBlock => block.type === "text")
    .map((block) => block.text)
    .join("");

class ClaudeSession implements ProviderSession {
  private readonly messages: Anthropic.Beta.BetaMessageParam[];
  private readonly functionTools: Anthropic.Beta.BetaToolUnion[];

  constructor(private readonly options: SessionOptions) {
    this.messages = [{ role: "user", content: options.userMessage }];
    this.functionTools = options.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }));
  }

  async step(hooks: StepHooks): Promise<StepResult> {
    let streamed = false;
    const tracked: StepHooks = {
      ...hooks,
      onText: (delta) => {
        streamed = true;
        hooks.onText(delta);
      },
    };
    // Only retry elsewhere before anything reached the chat.
    const { result, model } = await withBackend(
      this.options.model,
      (active, current) => this.run(active, current, tracked),
      () => !streamed && !hooks.signal.aborted,
    );
    return model.id === this.options.model.id ? result : { ...result, billedModel: model };
  }

  private async run(active: ClaudeBackend, model: AiModel, { signal, onText, onActivity }: StepHooks): Promise<StepResult> {
    const { system, maxOutputTokens, temperature, webSearch } = this.options;
    const search = active.host === "anthropic" && webSearch ? webSearchTool(model) : null;
    const tools = search ? [...this.functionTools, search] : this.functionTools;

    const stream = active.messages.stream(
      {
        model: active.modelId(model),
        max_tokens: maxOutputTokens,
        // Stable per agent, so repeated replies reuse the cached prefix.
        system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
        messages: this.messages,
        ...(tools.length > 0 ? { tools } : {}),
        ...(model.supportsTemperature && temperature !== undefined ? { temperature } : {}),
        ...fallbackParams(active, model),
      },
      { signal },
    );

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        onText(event.delta.text);
      } else if (event.type === "content_block_start" && event.content_block.type === "server_tool_use") {
        onActivity?.({ kind: "web", label: "Searching the web" });
      }
    }

    const message = await stream.finalMessage();
    const content = active.host === "anthropic" ? echoableContent(message.content) : message.content;
    this.messages.push({
      role: "assistant",
      content: active.host === "anthropic" ? (content as Anthropic.Beta.BetaContentBlockParam[]) : plainContent(content),
    });

    const toolCalls: ToolCall[] = content
      .filter((block): block is Anthropic.Beta.BetaToolUseBlock => block.type === "tool_use")
      .map((block) => ({ id: block.id, name: block.name, input: (block.input ?? {}) as Record<string, unknown> }));

    return {
      text: textOf(content),
      toolCalls,
      usage: usageOf(message),
      outcome: outcomeOf(message.stop_reason, toolCalls.length),
      servedModel: message.model,
    };
  }

  addToolResults(results: ToolResult[]) {
    this.messages.push({
      role: "user",
      content: results.map((result) => ({
        type: "tool_result" as const,
        tool_use_id: result.callId,
        content: result.output,
        ...(result.isError ? { is_error: true } : {}),
      })),
    });
  }
}

function jsonFromText(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new SyntaxError("The reply didn't contain a JSON object.");
  return JSON.parse(text.slice(start, end + 1));
}

async function structured<T>(
  active: ClaudeBackend,
  { model, system, prompt, jsonSchema, parse, maxOutputTokens, signal }: StructuredRequest<T>,
): Promise<{ value: T; usage: StepUsage }> {
  if (active.host === "anthropic") {
    const response = await active.messages.create(
      {
        model: model.id,
        max_tokens: maxOutputTokens,
        system,
        messages: [{ role: "user", content: prompt }],
        output_config: { format: { type: "json_schema", schema: jsonSchema } },
        ...fallbackParams(active, model),
      },
      { signal },
    );
    if (response.stop_reason === "refusal") {
      throw new ProviderError("refused", "anthropic", "The model declined to design this agent.");
    }
    return { value: parse(JSON.parse(textOf(response.content))), usage: usageOf(response) };
  }

  // Bedrock has no structured outputs, so the result arrives as a tool call whose input follows the same schema.
  // The caller validates it again either way.
  const response = await active.messages.create(
    {
      model: active.modelId(model),
      max_tokens: maxOutputTokens,
      system: `${system}\n\nDeliver the finished result by calling the ${RESULT_TOOL} tool exactly once, with every field filled in.`,
      messages: [{ role: "user", content: prompt }],
      tools: [{ name: RESULT_TOOL, description: "Submit the finished result.", input_schema: { ...jsonSchema, type: "object" } }],
    },
    { signal },
  );
  if (response.stop_reason === "refusal") {
    throw new ProviderError("refused", "anthropic", "The model declined to design this agent.");
  }
  const call = response.content.find(
    (block): block is Anthropic.Beta.BetaToolUseBlock => block.type === "tool_use" && block.name === RESULT_TOOL,
  );
  return { value: parse(call ? call.input : jsonFromText(textOf(response.content))), usage: usageOf(response) };
}

export const anthropicProvider: AiProviderClient = {
  createSession: (options) => new ClaudeSession(options),

  async generateObject(request) {
    const { result, model } = await withBackend(
      request.model,
      (active, current) => structured(active, { ...request, model: current }),
      () => !request.signal?.aborted,
    );
    return model.id === request.model.id ? result : { ...result, model };
  },
};
