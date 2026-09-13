import "server-only";

import {
  ApiError,
  GoogleGenAI,
  type Content,
  type FunctionDeclaration,
  type GenerateContentResponseUsageMetadata,
  type Part,
} from "@google/genai";

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

let client: GoogleGenAI | null = null;

function getClient() {
  const apiKey = aiEnv.geminiKey;
  if (!apiKey) throw new ProviderError("not_configured", "google", "Google Gemini isn't connected on this server yet.");
  client ??= new GoogleGenAI({ apiKey });
  return client;
}

function usageOf(metadata: GenerateContentResponseUsageMetadata | undefined): StepUsage {
  return {
    inputTokens: metadata?.promptTokenCount ?? 0,
    // Thinking tokens are billed as output.
    outputTokens: (metadata?.candidatesTokenCount ?? 0) + (metadata?.thoughtsTokenCount ?? 0),
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    webSearches: 0,
  };
}

const REFUSAL_REASONS = new Set(["SAFETY", "PROHIBITED_CONTENT", "BLOCKLIST", "SPII", "RECITATION"]);

function outcomeOf(finishReason: string | undefined, toolCalls: number): StepOutcome {
  if (toolCalls > 0) return "tool_calls";
  if (finishReason === "MAX_TOKENS") return "max_tokens";
  if (finishReason && REFUSAL_REASONS.has(finishReason)) return "refused";
  return "done";
}

/**
 * Streaming splits text over many parts. Plain runs are joined; anything that
 * carries a function call or a thought signature is kept exactly as received,
 * because Gemini 3 needs those signatures sent back with the history.
 */
function compactParts(parts: Part[]): Part[] {
  const isPlainText = (part: Part) =>
    typeof part.text === "string" && !part.thought && !part.thoughtSignature && !part.functionCall;
  const merged: Part[] = [];
  for (const part of parts) {
    const last = merged[merged.length - 1];
    if (last && isPlainText(last) && isPlainText(part)) {
      merged[merged.length - 1] = { text: `${last.text ?? ""}${part.text ?? ""}` };
    } else {
      merged.push(part);
    }
  }
  return merged;
}

function translateError(error: unknown): never {
  if (error instanceof Error && error.name === "AbortError") throw error;
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) {
      throw new ProviderError("auth", "google", "Google rejected this server's Gemini API key.");
    }
    if (error.status === 429) {
      throw new ProviderError("rate_limited", "google", "Gemini is busy right now. Try again in a moment.");
    }
    if (error.status >= 500) {
      throw new ProviderError("overloaded", "google", "Gemini had a temporary problem. Try again in a moment.");
    }
    throw new ProviderError("bad_request", "google", `Gemini couldn't process the request: ${error.message}`);
  }
  throw error;
}

class GeminiSession implements ProviderSession {
  private readonly contents: Content[];
  private readonly declarations: FunctionDeclaration[];
  /** Calls Gemini didn't give an id to; their responses must not invent one. */
  private readonly unnamedCallIds = new Set<string>();

  constructor(private readonly options: SessionOptions) {
    this.contents = [{ role: "user", parts: [{ text: options.userMessage }] }];
    this.declarations = options.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      parametersJsonSchema: tool.parameters,
    }));
  }

  async step({ signal, onText }: StepHooks): Promise<StepResult> {
    const { model, system, maxOutputTokens, temperature } = this.options;
    try {
      const stream = await getClient().models.generateContentStream({
        model: model.id,
        contents: this.contents,
        config: {
          systemInstruction: system,
          maxOutputTokens,
          abortSignal: signal,
          ...(this.declarations.length > 0 ? { tools: [{ functionDeclarations: this.declarations }] } : {}),
          ...(model.supportsTemperature && temperature !== undefined ? { temperature } : {}),
        },
      });

      const parts: Part[] = [];
      let finishReason: string | undefined;
      let usage: GenerateContentResponseUsageMetadata | undefined;

      for await (const chunk of stream) {
        const candidate = chunk.candidates?.[0];
        for (const part of candidate?.content?.parts ?? []) {
          parts.push(part);
          if (part.text && !part.thought) onText(part.text);
        }
        if (candidate?.finishReason) finishReason = candidate.finishReason;
        if (chunk.usageMetadata) usage = chunk.usageMetadata;
      }

      const modelParts = compactParts(parts);
      if (modelParts.length > 0) this.contents.push({ role: "model", parts: modelParts });

      const toolCalls: ToolCall[] = [];
      modelParts.forEach((part, index) => {
        const call = part.functionCall;
        if (!call?.name) return;
        const id = call.id ?? `${call.name}:${this.contents.length}:${index}`;
        if (!call.id) this.unnamedCallIds.add(id);
        toolCalls.push({ id, name: call.name, input: call.args ?? {} });
      });

      return {
        text: modelParts
          .filter((part) => part.text && !part.thought)
          .map((part) => part.text)
          .join(""),
        toolCalls,
        usage: usageOf(usage),
        outcome: outcomeOf(finishReason, toolCalls.length),
      };
    } catch (error) {
      translateError(error);
    }
  }

  addToolResults(results: ToolResult[]) {
    this.contents.push({
      role: "user",
      parts: results.map((result) => ({
        functionResponse: {
          ...(this.unnamedCallIds.has(result.callId) ? {} : { id: result.callId }),
          name: result.name,
          response: result.isError ? { error: result.output } : { output: result.output },
        },
      })),
    });
  }
}

export const googleProvider: AiProviderClient = {
  createSession: (options) => new GeminiSession(options),

  async generateObject<T>({ model, system, prompt, jsonSchema, parse, maxOutputTokens, signal }: StructuredRequest<T>) {
    try {
      const response = await getClient().models.generateContent({
        model: model.id,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: {
          systemInstruction: system,
          responseMimeType: "application/json",
          responseJsonSchema: jsonSchema,
          maxOutputTokens,
          ...(signal ? { abortSignal: signal } : {}),
        },
      });
      const finishReason = response.candidates?.[0]?.finishReason;
      if (finishReason && REFUSAL_REASONS.has(finishReason)) {
        throw new ProviderError("refused", "google", "The model declined to design this agent.");
      }
      return { value: parse(JSON.parse(response.text ?? "")), usage: usageOf(response.usageMetadata) };
    } catch (error) {
      if (error instanceof ProviderError || error instanceof SyntaxError) throw error;
      translateError(error);
    }
  },
};
