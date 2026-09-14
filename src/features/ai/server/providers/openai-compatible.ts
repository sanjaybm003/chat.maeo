import "server-only";

import OpenAI from "openai";

import { logger } from "@/lib/logger";

import type { AiModel } from "../../models";
import { markModelRefused, MODEL_PROBLEM } from "../availability";
import { aiEnv } from "../env";
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

type CompatibleProvider = "openai" | "deepseek" | "bedrock";

interface Settings {
  label: string;
  baseURL: () => string | undefined;
  apiKey: () => string | null;
  maxTokensField: "max_tokens" | "max_completion_tokens";
  /** Whether the endpoint accepts response_format: json_object. */
  jsonMode: boolean;
}

/** OpenAI, DeepSeek and Amazon Bedrock's open models all speak the Chat Completions API. */
const SETTINGS: Record<CompatibleProvider, Settings> = {
  openai: {
    label: "OpenAI",
    baseURL: () => undefined,
    apiKey: () => aiEnv.openaiKey,
    maxTokensField: "max_completion_tokens",
    jsonMode: true,
  },
  deepseek: {
    label: "DeepSeek",
    baseURL: () => "https://api.deepseek.com",
    apiKey: () => aiEnv.deepseekKey,
    maxTokensField: "max_tokens",
    jsonMode: true,
  },
  bedrock: {
    label: "Amazon Bedrock",
    // The bedrock-mantle endpoint's OpenAI-compatible API, with a Bedrock API key as the bearer token.
    baseURL: () => process.env.BEDROCK_OPENAI_BASE_URL?.trim() || `https://bedrock-mantle.${aiEnv.bedrockRegion}.api.aws/v1`,
    apiKey: () => aiEnv.bedrockKey,
    maxTokensField: "max_tokens",
    jsonMode: false,
  },
};

const UNAVAILABLE = "AI isn’t available right now. Try again soon.";

const log = logger.child({ module: "chat-completions" });

const clients = new Map<CompatibleProvider, OpenAI>();

function getClient(provider: CompatibleProvider) {
  const settings = SETTINGS[provider];
  const apiKey = settings.apiKey();
  if (!apiKey) {
    log.error(`${settings.label} isn't configured on this server`);
    throw new ProviderError("not_configured", provider, UNAVAILABLE);
  }
  let existing = clients.get(provider);
  if (!existing) {
    const baseURL = settings.baseURL();
    existing = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });
    clients.set(provider, existing);
  }
  return existing;
}

/** Never asks for a longer answer than the model allows; some open models cap it at 8K. */
function maxTokens(provider: CompatibleProvider, model: AiModel, requested: number) {
  const value = model.maxOutputTokens ? Math.min(requested, model.maxOutputTokens) : requested;
  return SETTINGS[provider].maxTokensField === "max_tokens" ? { max_tokens: value } : { max_completion_tokens: value };
}

function usageOf(usage: OpenAI.CompletionUsage | null | undefined): StepUsage {
  return {
    inputTokens: usage?.prompt_tokens ?? 0,
    outputTokens: usage?.completion_tokens ?? 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    webSearches: 0,
  };
}

function outcomeOf(finishReason: string | null | undefined, toolCalls: number): StepOutcome {
  if (toolCalls > 0) return "tool_calls";
  if (finishReason === "length") return "max_tokens";
  if (finishReason === "content_filter") return "refused";
  return "done";
}

function parseArguments(raw: string): Record<string, unknown> {
  if (!raw.trim()) return {};
  try {
    const value: unknown = JSON.parse(raw);
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  } catch {
    return { __invalid_arguments: raw.slice(0, 500) };
  }
}

/** The first JSON object in a reply, tolerating code fences or a sentence around it. */
function jsonFromText(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new SyntaxError("The reply didn't contain a JSON object.");
  return JSON.parse(text.slice(start, end + 1));
}

const REASONING_TAGS = [
  { open: "<think>", close: "</think>" },
  { open: "<reasoning>", close: "</reasoning>" },
] as const;

/** How much of the end of the text could be the start of a reasoning tag still arriving. */
function partialTagLength(text: string) {
  for (let length = Math.min(text.length, 10); length > 0; length -= 1) {
    const tail = text.slice(-length);
    if (REASONING_TAGS.some((tag) => tag.open.length > length && tag.open.startsWith(tail))) return length;
  }
  return 0;
}

/**
 * Some open models write their reasoning inline between tags. It never belongs
 * in the chat, so it's dropped as the reply streams, even when a tag is split
 * across chunks.
 */
export class ReasoningFilter {
  private pending = "";
  private closing: string | null = null;
  private started = false;

  push(chunk: string): string {
    this.pending += chunk;
    let visible = "";
    for (;;) {
      if (this.closing) {
        const end = this.pending.indexOf(this.closing);
        if (end === -1) {
          // Keep just enough to spot a closing tag that's still arriving.
          this.pending = this.pending.slice(-(this.closing.length - 1));
          return this.show(visible);
        }
        this.pending = this.pending.slice(end + this.closing.length);
        this.closing = null;
        continue;
      }
      const next = REASONING_TAGS.map((tag) => ({ tag, at: this.pending.indexOf(tag.open) }))
        .filter((item) => item.at !== -1)
        .sort((a, b) => a.at - b.at)[0];
      if (next) {
        visible += this.pending.slice(0, next.at);
        this.pending = this.pending.slice(next.at + next.tag.open.length);
        this.closing = next.tag.close;
        continue;
      }
      const held = partialTagLength(this.pending);
      visible += this.pending.slice(0, this.pending.length - held);
      this.pending = this.pending.slice(this.pending.length - held);
      return this.show(visible);
    }
  }

  flush(): string {
    const rest = this.closing ? "" : this.pending;
    this.pending = "";
    return this.show(rest);
  }

  /** Reasoning usually comes first, so the answer starts without the blank lines left behind. */
  private show(text: string) {
    if (this.started) return text;
    const trimmed = text.trimStart();
    if (trimmed) this.started = true;
    return trimmed;
  }
}

function withoutReasoning(text: string) {
  const filter = new ReasoningFilter();
  return filter.push(text) + filter.flush();
}

function detailOf(error: unknown) {
  if (error instanceof OpenAI.APIError) {
    const body = error.error as { message?: unknown } | undefined;
    const reason = typeof body?.message === "string" ? body.message : error.message;
    return `${error.status ?? ""} ${reason}`.trim().slice(0, 400);
  }
  return (error instanceof Error ? error.message : String(error)).trim().slice(0, 400);
}

function fail(kind: ProviderErrorKind, provider: CompatibleProvider, message: string, error: unknown): never {
  throw new ProviderError(kind, provider, message, detailOf(error));
}

/** Details stay in the server log and the asker's private run record; the chat gets a plain message. */
function translateError(provider: CompatibleProvider, model: AiModel, error: unknown): never {
  const label = SETTINGS[provider].label;
  if (error instanceof OpenAI.APIUserAbortError || error instanceof ProviderError) throw error;

  const refused =
    error instanceof OpenAI.NotFoundError ||
    ((error instanceof OpenAI.PermissionDeniedError || error instanceof OpenAI.BadRequestError) && MODEL_PROBLEM.test(error.message));
  if (refused) {
    markModelRefused(model.id);
    log.warn(`${label} refused ${model.label}; routing around it for now`, { detail: detailOf(error) });
    fail("unavailable", provider, UNAVAILABLE, error);
  }
  if (error instanceof OpenAI.AuthenticationError || error instanceof OpenAI.PermissionDeniedError) {
    log.error(`${label} refused the credentials`, { error });
    fail("auth", provider, UNAVAILABLE, error);
  }
  if (error instanceof OpenAI.RateLimitError) {
    log.warn(`${label} rate limited the request`, { error });
    fail("rate_limited", provider, "AI is busy right now. Try again in a moment.", error);
  }
  if (error instanceof OpenAI.BadRequestError) {
    log.warn(`${label} rejected the request`, { error });
    fail("bad_request", provider, "The AI couldn’t process that request.", error);
  }
  if (error instanceof OpenAI.InternalServerError) {
    fail("overloaded", provider, "AI had a temporary problem. Try again in a moment.", error);
  }
  if (error instanceof OpenAI.APIConnectionError) {
    log.warn(`Couldn't reach ${label}`, { error });
    fail("network", provider, "Couldn’t reach the AI service. Try again in a moment.", error);
  }
  throw error;
}

class CompatibleSession implements ProviderSession {
  private readonly messages: OpenAI.Chat.ChatCompletionMessageParam[];
  private readonly tools: OpenAI.Chat.ChatCompletionFunctionTool[];

  constructor(
    private readonly provider: CompatibleProvider,
    private readonly options: SessionOptions,
  ) {
    this.messages = [
      { role: "system", content: options.system },
      { role: "user", content: options.userMessage },
    ];
    this.tools = options.tools.map((tool) => ({
      type: "function",
      function: { name: tool.name, description: tool.description, parameters: tool.parameters },
    }));
  }

  async step({ signal, onText }: StepHooks): Promise<StepResult> {
    const { model, maxOutputTokens, temperature } = this.options;
    try {
      const stream = await getClient(this.provider).chat.completions.create(
        {
          model: model.id,
          messages: this.messages,
          stream: true,
          stream_options: { include_usage: true },
          ...(this.tools.length > 0 ? { tools: this.tools } : {}),
          ...maxTokens(this.provider, model, maxOutputTokens),
          ...(model.supportsTemperature && temperature !== undefined ? { temperature } : {}),
        },
        { signal },
      );

      let text = "";
      const reasoning = new ReasoningFilter();
      let finishReason: string | null | undefined;
      let usage: OpenAI.CompletionUsage | null | undefined;
      const calls = new Map<number, { id: string; name: string; arguments: string }>();

      for await (const chunk of stream) {
        if (chunk.usage) usage = chunk.usage;
        const choice = chunk.choices[0];
        if (!choice) continue;
        const visible = choice.delta.content ? reasoning.push(choice.delta.content) : "";
        if (visible) {
          text += visible;
          onText(visible);
        }
        for (const delta of choice.delta.tool_calls ?? []) {
          const entry = calls.get(delta.index) ?? { id: "", name: "", arguments: "" };
          if (delta.id) entry.id = delta.id;
          if (delta.function?.name) entry.name += delta.function.name;
          if (delta.function?.arguments) entry.arguments += delta.function.arguments;
          calls.set(delta.index, entry);
        }
        if (choice.finish_reason) finishReason = choice.finish_reason;
      }
      const tail = reasoning.flush();
      if (tail) {
        text += tail;
        onText(tail);
      }

      const ordered = [...calls.entries()]
        .sort(([a], [b]) => a - b)
        .map(([index, call]) => ({ ...call, id: call.id || `call_${index}` }))
        .filter((call) => call.name);

      this.messages.push({
        role: "assistant",
        content: text || null,
        ...(ordered.length > 0
          ? {
              tool_calls: ordered.map((call) => ({
                id: call.id,
                type: "function" as const,
                function: { name: call.name, arguments: call.arguments || "{}" },
              })),
            }
          : {}),
      });

      const toolCalls: ToolCall[] = ordered.map((call) => ({
        id: call.id,
        name: call.name,
        input: parseArguments(call.arguments),
      }));

      return { text, toolCalls, usage: usageOf(usage), outcome: outcomeOf(finishReason, toolCalls.length) };
    } catch (error) {
      translateError(this.provider, model, error);
    }
  }

  addToolResults(results: ToolResult[]) {
    for (const result of results) {
      this.messages.push({ role: "tool", tool_call_id: result.callId, content: result.output });
    }
  }
}

function compatibleProvider(provider: CompatibleProvider): AiProviderClient {
  return {
    createSession: (options) => new CompatibleSession(provider, options),

    async generateObject<T>({ model, system, prompt, jsonSchema, parse, maxOutputTokens, signal }: StructuredRequest<T>) {
      try {
        const response = await getClient(provider).chat.completions.create(
          {
            model: model.id,
            messages: [
              {
                role: "system",
                content: `${system}\n\nRespond with only one JSON object that matches this JSON Schema, with no other text:\n${JSON.stringify(jsonSchema)}`,
              },
              { role: "user", content: prompt },
            ],
            ...(SETTINGS[provider].jsonMode ? { response_format: { type: "json_object" as const } } : {}),
            ...maxTokens(provider, model, maxOutputTokens),
          },
          { signal },
        );
        const choice = response.choices[0];
        if (choice?.finish_reason === "content_filter") {
          throw new ProviderError("refused", provider, "The model declined to design this agent.");
        }
        return { value: parse(jsonFromText(withoutReasoning(choice?.message.content ?? ""))), usage: usageOf(response.usage) };
      } catch (error) {
        if (error instanceof ProviderError || error instanceof SyntaxError) throw error;
        translateError(provider, model, error);
      }
    },
  };
}

export const openaiProvider = compatibleProvider("openai");
export const deepseekProvider = compatibleProvider("deepseek");
export const bedrockProvider = compatibleProvider("bedrock");
