import "server-only";

import Anthropic from "@anthropic-ai/sdk";

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
 * Server-side refusal fallbacks: when a model's safety classifiers decline a
 * request, Anthropic re-runs it on its recommended fallback model in the same
 * call instead of returning a refusal.
 */
const SERVER_FALLBACK_MODELS = new Set(["claude-opus-5"]);
const SERVER_FALLBACK_BETA = "server-side-fallback-2026-07-01";
const WEB_SEARCH_MAX_USES = 3;

let client: Anthropic | null = null;

function getClient() {
  const apiKey = aiEnv.anthropicKey;
  if (!apiKey) throw new ProviderError("not_configured", "anthropic", "Anthropic isn't connected on this server yet.");
  client ??= new Anthropic({ apiKey });
  return client;
}

function fallbackParams(model: AiModel) {
  return SERVER_FALLBACK_MODELS.has(model.id)
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

function translateError(error: unknown): never {
  if (error instanceof Anthropic.APIUserAbortError) throw error;
  if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
    throw new ProviderError("auth", "anthropic", "Anthropic rejected this server's API key.");
  }
  if (error instanceof Anthropic.RateLimitError) {
    throw new ProviderError("rate_limited", "anthropic", "Anthropic is busy right now. Try again in a moment.");
  }
  if (error instanceof Anthropic.BadRequestError) {
    throw new ProviderError("bad_request", "anthropic", `Anthropic couldn't process the request: ${error.message}`);
  }
  if (error instanceof Anthropic.InternalServerError) {
    throw new ProviderError("overloaded", "anthropic", "Anthropic had a temporary problem. Try again in a moment.");
  }
  if (error instanceof Anthropic.APIConnectionError) {
    throw new ProviderError("network", "anthropic", "Couldn't reach Anthropic.");
  }
  throw error;
}

class AnthropicSession implements ProviderSession {
  private readonly messages: Anthropic.Beta.BetaMessageParam[];
  private readonly tools: Anthropic.Beta.BetaToolUnion[];

  constructor(private readonly options: SessionOptions) {
    this.messages = [{ role: "user", content: options.userMessage }];
    this.tools = options.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    }));
    const search = options.webSearch ? webSearchTool(options.model) : null;
    if (search) this.tools.push(search);
  }

  async step({ signal, onText, onActivity }: StepHooks): Promise<StepResult> {
    const { model, system, maxOutputTokens, temperature } = this.options;
    try {
      const stream = getClient().beta.messages.stream(
        {
          model: model.id,
          max_tokens: maxOutputTokens,
          // Stable per agent, so repeated replies reuse the cached prefix.
          system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
          messages: this.messages,
          ...(this.tools.length > 0 ? { tools: this.tools } : {}),
          ...(model.supportsTemperature && temperature !== undefined ? { temperature } : {}),
          ...fallbackParams(model),
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
    } catch (error) {
      translateError(error);
    }
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

export const anthropicProvider: AiProviderClient = {
  createSession: (options) => new AnthropicSession(options),

  async generateObject<T>({ model, system, prompt, jsonSchema, parse, maxOutputTokens, signal }: StructuredRequest<T>) {
    try {
      const response = await getClient().beta.messages.create(
        {
          model: model.id,
          max_tokens: maxOutputTokens,
          system,
          messages: [{ role: "user", content: prompt }],
          output_config: { format: { type: "json_schema", schema: jsonSchema } },
          ...fallbackParams(model),
        },
        { signal },
      );
      if (response.stop_reason === "refusal") {
        throw new ProviderError("refused", "anthropic", "The model declined to design this agent.");
      }
      return { value: parse(JSON.parse(textOf(response.content))), usage: usageOf(response) };
    } catch (error) {
      if (error instanceof ProviderError || error instanceof SyntaxError) throw error;
      translateError(error);
    }
  },
};
