import "server-only";

import OpenAI from "openai";

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

type CompatibleProvider = "openai" | "deepseek";

/** OpenAI and DeepSeek both speak the Chat Completions API. */
const SETTINGS: Record<
  CompatibleProvider,
  { label: string; baseURL?: string; apiKey: () => string | null; maxTokensField: "max_tokens" | "max_completion_tokens" }
> = {
  openai: { label: "OpenAI", apiKey: () => aiEnv.openaiKey, maxTokensField: "max_completion_tokens" },
  deepseek: {
    label: "DeepSeek",
    baseURL: "https://api.deepseek.com",
    apiKey: () => aiEnv.deepseekKey,
    maxTokensField: "max_tokens",
  },
};

const clients = new Map<CompatibleProvider, OpenAI>();

function getClient(provider: CompatibleProvider) {
  const settings = SETTINGS[provider];
  const apiKey = settings.apiKey();
  if (!apiKey) throw new ProviderError("not_configured", provider, `${settings.label} isn't connected on this server yet.`);
  let existing = clients.get(provider);
  if (!existing) {
    existing = new OpenAI({ apiKey, ...(settings.baseURL ? { baseURL: settings.baseURL } : {}) });
    clients.set(provider, existing);
  }
  return existing;
}

const maxTokens = (provider: CompatibleProvider, value: number) =>
  SETTINGS[provider].maxTokensField === "max_tokens" ? { max_tokens: value } : { max_completion_tokens: value };

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

function translateError(provider: CompatibleProvider, error: unknown): never {
  const label = SETTINGS[provider].label;
  if (error instanceof OpenAI.APIUserAbortError) throw error;
  if (error instanceof OpenAI.AuthenticationError || error instanceof OpenAI.PermissionDeniedError) {
    throw new ProviderError("auth", provider, `${label} rejected this server's API key.`);
  }
  if (error instanceof OpenAI.RateLimitError) {
    throw new ProviderError("rate_limited", provider, `${label} is busy right now. Try again in a moment.`);
  }
  if (error instanceof OpenAI.BadRequestError) {
    throw new ProviderError("bad_request", provider, `${label} couldn't process the request: ${error.message}`);
  }
  if (error instanceof OpenAI.InternalServerError) {
    throw new ProviderError("overloaded", provider, `${label} had a temporary problem. Try again in a moment.`);
  }
  if (error instanceof OpenAI.APIConnectionError) {
    throw new ProviderError("network", provider, `Couldn't reach ${label}.`);
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
          ...maxTokens(this.provider, maxOutputTokens),
          ...(model.supportsTemperature && temperature !== undefined ? { temperature } : {}),
        },
        { signal },
      );

      let text = "";
      let finishReason: string | null | undefined;
      let usage: OpenAI.CompletionUsage | null | undefined;
      const calls = new Map<number, { id: string; name: string; arguments: string }>();

      for await (const chunk of stream) {
        if (chunk.usage) usage = chunk.usage;
        const choice = chunk.choices[0];
        if (!choice) continue;
        if (choice.delta.content) {
          text += choice.delta.content;
          onText(choice.delta.content);
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
      translateError(this.provider, error);
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
                content: `${system}\n\nRespond with one JSON object that matches this JSON Schema:\n${JSON.stringify(jsonSchema)}`,
              },
              { role: "user", content: prompt },
            ],
            response_format: { type: "json_object" },
            ...maxTokens(provider, maxOutputTokens),
          },
          { signal },
        );
        const choice = response.choices[0];
        if (choice?.finish_reason === "content_filter") {
          throw new ProviderError("refused", provider, "The model declined to design this agent.");
        }
        return { value: parse(JSON.parse(choice?.message.content ?? "")), usage: usageOf(response.usage) };
      } catch (error) {
        if (error instanceof ProviderError || error instanceof SyntaxError) throw error;
        translateError(provider, error);
      }
    },
  };
}

export const openaiProvider = compatibleProvider("openai");
export const deepseekProvider = compatibleProvider("deepseek");
