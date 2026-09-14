import "server-only";

import { AnthropicBedrock, AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import Anthropic from "@anthropic-ai/sdk";

import { logger } from "@/lib/logger";

import { bedrockModelId, type BedrockEndpoint, type ClaudeHost } from "../../claude-hosts";
import type { AiModel } from "../../models";
import { aiEnv } from "../env";
import {
  ProviderError,
  type AiProviderClient,
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
 * structured outputs).
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

const UNAVAILABLE = "AI isn’t available right now. Try again soon.";

const log = logger.child({ module: "claude" });

type BetaMessages = Pick<Anthropic["beta"]["messages"], "create" | "stream">;

interface ClaudeBackend {
  host: ClaudeHost;
  endpoint: "api" | BedrockEndpoint;
  messages: BetaMessages;
  modelId: (model: AiModel) => string;
}

let anthropicMessages: BetaMessages | null = null;
const bedrockMessages: Partial<Record<BedrockEndpoint, BetaMessages>> = {};
/** Set once the runtime endpoint has worked for a key the Messages endpoint refused. */
let preferRuntime = false;

function bedrockBackend(endpoint: BedrockEndpoint): ClaudeBackend {
  const apiKey = aiEnv.bedrockKey ?? undefined;
  const awsRegion = aiEnv.bedrockRegion;
  bedrockMessages[endpoint] ??=
    endpoint === "mantle"
      ? new AnthropicBedrockMantle({ apiKey, awsRegion }).beta.messages
      : new AnthropicBedrock({ apiKey, awsRegion }).beta.messages;
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

const isAccessError = (error: unknown) =>
  error instanceof Anthropic.AuthenticationError ||
  error instanceof Anthropic.PermissionDeniedError ||
  error instanceof Anthropic.NotFoundError;

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

/** Details stay in the server log; people in the chat get a plain message. */
function translateError(error: unknown, active: ClaudeBackend): never {
  if (error instanceof Anthropic.APIUserAbortError || error instanceof ProviderError) throw error;
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    log.error(`${describe(active)} refused the credentials`, {
      status: error.status,
      hint: active.host === "bedrock" ? bedrockHint() : "Check ANTHROPIC_API_KEY.",
      error,
    });
    throw new ProviderError("auth", "anthropic", UNAVAILABLE);
  }
  if (error instanceof Anthropic.NotFoundError) {
    log.error(`${describe(active)} doesn't offer the requested model`, { error });
    throw new ProviderError("bad_request", "anthropic", "This model isn’t available right now. Try another model.");
  }
  if (error instanceof Anthropic.RateLimitError) {
    log.warn(`${describe(active)} rate limited the request`, { error });
    throw new ProviderError("rate_limited", "anthropic", "AI is busy right now. Try again in a moment.");
  }
  if (error instanceof Anthropic.BadRequestError) {
    log.warn(`${describe(active)} rejected the request`, { error });
    throw new ProviderError("bad_request", "anthropic", "The AI couldn’t process that request.");
  }
  if (error instanceof Anthropic.InternalServerError) {
    throw new ProviderError("overloaded", "anthropic", "AI had a temporary problem. Try again in a moment.");
  }
  if (error instanceof Anthropic.APIConnectionError) {
    log.warn(`Couldn't reach the ${describe(active)}`, { error });
    throw new ProviderError("network", "anthropic", "Couldn’t reach the AI service. Try again in a moment.");
  }
  throw error;
}

/**
 * Runs a call on the current backend. When a Bedrock key is refused by the
 * Messages endpoint (some keys and policies only allow the runtime endpoint),
 * retries once on the runtime endpoint and, if that works, keeps using it.
 */
async function withBackend<T>(run: (active: ClaudeBackend) => Promise<T>, canRetry: () => boolean): Promise<T> {
  const active = backend();
  try {
    return await run(active);
  } catch (error) {
    const retry = active.host === "bedrock" && active.endpoint === "mantle" && !aiEnv.bedrockEndpoint && isAccessError(error) && canRetry();
    if (!retry) translateError(error, active);

    const runtime = bedrockBackend("runtime");
    try {
      const result = await run(runtime);
      if (!preferRuntime) {
        preferRuntime = true;
        log.warn("Bedrock Messages endpoint refused this key; using the Bedrock runtime endpoint", {
          status: (error as { status?: number }).status,
        });
      }
      return result;
    } catch (retryError) {
      if (isAccessError(retryError)) {
        log.error("Both Bedrock endpoints refused the request", {
          messagesStatus: (error as { status?: number }).status,
          runtimeStatus: (retryError as { status?: number }).status,
        });
      }
      translateError(retryError, runtime);
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

  step(hooks: StepHooks): Promise<StepResult> {
    let streamed = false;
    const tracked: StepHooks = {
      ...hooks,
      onText: (delta) => {
        streamed = true;
        hooks.onText(delta);
      },
    };
    // Only retry on another endpoint before anything reached the chat.
    return withBackend((active) => this.run(active, tracked), () => !streamed && !hooks.signal.aborted);
  }

  private async run(active: ClaudeBackend, { signal, onText, onActivity }: StepHooks): Promise<StepResult> {
    const { model, system, maxOutputTokens, temperature, webSearch } = this.options;
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
    const content = echoableContent(message.content);
    this.messages.push({ role: "assistant", content: content as Anthropic.Beta.BetaContentBlockParam[] });

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

  generateObject: (request) => withBackend((active) => structured(active, request), () => !request.signal?.aborted),
};
