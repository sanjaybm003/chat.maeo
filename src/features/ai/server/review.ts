import "server-only";

import { z } from "zod";

import type { AiModel } from "../models";
import { providerClient } from "./providers";
import type { StepUsage } from "./providers/types";

/**
 * The double-check: a second read of a finished reply against the
 * conversation and everything the tools returned, before the team relies on
 * it. It corrects rather than rewrites.
 */

export const REVIEW_SYSTEM = `You check an AI teammate's draft reply before a team relies on it. You see the conversation and request it answered, the evidence its tools returned, the agent's rules and the draft.

Check, strictly against that material:
- Every claim about the team, its work, numbers, names, dates, links and code is supported by the conversation, the evidence or the team knowledge.
- The draft answers exactly what was asked, in the format asked for, and follows the agent's rules.
- Nothing is presented as done that wasn't done: a pull request opened is not merged, a task created is not finished.

If the draft is accurate and complete, return verdict "ok", no issues and an empty reply.
Otherwise return verdict "revise", each issue in a few words, and the full corrected reply. Keep everything that was right, and keep the same voice, format and language. Never add facts that aren't in the material; where something can't be confirmed, say so plainly in the reply.`;

const REVIEW_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["verdict", "issues", "reply"],
  properties: {
    verdict: { type: "string", enum: ["ok", "revise"] },
    issues: { type: "array", items: { type: "string" }, description: "Each problem found, in a few words. Empty when the draft is right." },
    reply: { type: "string", description: "The complete corrected reply when the verdict is revise; empty when it is ok." },
  },
} as const;

const reviewSchema = z.object({
  verdict: z.enum(["ok", "revise"]),
  issues: z.array(z.string()).default([]),
  reply: z.string().default(""),
});

export interface ReviewInput {
  model: AiModel;
  rules: string;
  /** The request as the agent saw it: conversation, reply note and message. */
  request: string;
  evidence: readonly string[];
  draft: string;
  signal: AbortSignal;
  maxOutputTokens: number;
}

export interface ReviewOutcome {
  verdict: "ok" | "revise";
  issues: string[];
  reply: string;
  usage: StepUsage;
  model: AiModel;
}

const MAX_EVIDENCE_CHARS = 16_000;

export function buildReviewPrompt({ rules, request, evidence, draft }: Pick<ReviewInput, "rules" | "request" | "evidence" | "draft">) {
  return `<agent_rules>
${rules.trim() || "(none)"}
</agent_rules>

<request>
${request}
</request>

<evidence>
${evidence.join("\n\n").slice(0, MAX_EVIDENCE_CHARS) || "(The agent used no tools.)"}
</evidence>

<draft_reply>
${draft}
</draft_reply>`;
}

export async function reviewReply(input: ReviewInput): Promise<ReviewOutcome> {
  const result = await providerClient(input.model.provider).generateObject({
    model: input.model,
    system: REVIEW_SYSTEM,
    prompt: buildReviewPrompt(input),
    jsonSchema: REVIEW_JSON_SCHEMA,
    parse: (value) => reviewSchema.parse(value),
    maxOutputTokens: input.maxOutputTokens,
    signal: input.signal,
  });
  return { ...result.value, usage: result.usage, model: result.model ?? input.model };
}
