import { z } from "zod";

import {
  AGENT_GLYPHS,
  AGENT_TOOL_IDS,
  MODEL_MODES,
  PERSON_COLORS,
  RESPONSE_STYLES,
  SPECIALTIES,
  type AgentGlyph,
  type AgentToolId,
  type PersonColor,
  type ResponseStyle,
  type Specialty,
} from "@/types/domain";

export { AGENT_GLYPHS, AGENT_TOOL_IDS, type AgentGlyph, type AgentToolId };

export const AGENT_TOOLS: readonly { id: AgentToolId; label: string; description: string }[] = [
  {
    id: "history",
    label: "Read earlier messages",
    description: "Scrolls back past the messages it already reads.",
  },
  {
    id: "search",
    label: "Search the workspace",
    description: "Finds messages from other chats, limited to what everyone in the current chat can already see.",
  },
  {
    id: "directory",
    label: "Know the team",
    description: "Looks up who’s here and what they do.",
  },
  {
    id: "web",
    label: "Search the web",
    description: "Looks things up online when a question needs current facts. Uses a model that can browse.",
  },
];

export const HANDLE_PATTERN = /^[a-z][a-z0-9-]{1,22}[a-z0-9]$/;
export const MAX_STARTERS = 3;
export const MAX_KNOWLEDGE = 8000;

/** "Release Notes Writer" → "release-notes-writer", always a valid handle. */
export function toHandle(name: string): string {
  let handle = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^[^a-z]+/, "")
    .slice(0, 24)
    .replace(/-+$/g, "");
  if (handle.length < 3) handle = `${handle || "agent"}-ai`.replace(/^-/, "").slice(0, 24);
  return HANDLE_PATTERN.test(handle) ? handle : "agent";
}

const uniqueTools = (tools: AgentToolId[]) => [...new Set(tools)];

export const agentInputSchema = z.object({
  workspaceId: z.uuid(),
  name: z.string().trim().min(2, "Use at least 2 characters.").max(40, "Keep it under 40 characters."),
  handle: z
    .string()
    .trim()
    .toLowerCase()
    .regex(HANDLE_PATTERN, "3–24 lowercase letters, numbers or dashes, starting with a letter."),
  tagline: z.string().trim().max(120, "Keep it under 120 characters.").default(""),
  instructions: z
    .string()
    .trim()
    .min(20, "Describe how it should work in at least a sentence.")
    .max(8000, "Keep instructions under 8,000 characters."),
  knowledge: z.string().trim().max(MAX_KNOWLEDGE, "Keep team knowledge under 8,000 characters.").default(""),
  specialty: z.enum(SPECIALTIES),
  responseStyle: z.enum(RESPONSE_STYLES),
  modelMode: z.enum(MODEL_MODES),
  model: z.string().min(3),
  tools: z.array(z.enum(AGENT_TOOL_IDS)).max(AGENT_TOOLS.length).transform(uniqueTools),
  starters: z.array(z.string().trim().min(1).max(120)).max(MAX_STARTERS),
  color: z.enum(PERSON_COLORS),
  glyph: z.enum(AGENT_GLYPHS),
  visibility: z.enum(["workspace", "private"]),
});

export type AgentInput = z.input<typeof agentInputSchema>;

export interface AgentDraft {
  name: string;
  handle: string;
  tagline: string;
  instructions: string;
  knowledge: string;
  specialty: Specialty;
  responseStyle: ResponseStyle;
  tools: AgentToolId[];
  starters: string[];
  color: PersonColor;
  glyph: AgentGlyph;
}

/** What the architect model must return. Lenient on purpose; normalizeDraft() tidies it. */
export const architectOutputSchema = z.object({
  name: z.string(),
  handle: z.string(),
  tagline: z.string(),
  instructions: z.string().min(20),
  knowledge: z.string().default(""),
  specialty: z.string(),
  responseStyle: z.string(),
  tools: z.array(z.string()),
  starters: z.array(z.string()),
  color: z.string(),
  glyph: z.string(),
});

/** Plain JSON Schema for structured output. No length keywords: not every provider accepts them. */
export const ARCHITECT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["name", "handle", "tagline", "instructions", "knowledge", "specialty", "responseStyle", "tools", "starters", "color", "glyph"],
  properties: {
    name: { type: "string", description: "A short, friendly name of one or two words. Not a job title." },
    handle: {
      type: "string",
      description: "Mention handle: 3-24 lowercase letters, digits or dashes, starting with a letter.",
    },
    tagline: { type: "string", description: "One line under 100 characters saying what it does for the team." },
    instructions: {
      type: "string",
      description: "The agent's operating instructions, written to the agent in second person.",
    },
    knowledge: {
      type: "string",
      description:
        "Facts, names, links, numbers or policies stated in the request that the agent should treat as reference, one per line. Empty when the request gives none. Never invent facts.",
    },
    specialty: {
      type: "string",
      enum: SPECIALTIES,
      description: "The kind of work: assistant (everyday help), research, writing, analysis, planning, support or engineering.",
    },
    responseStyle: {
      type: "string",
      enum: RESPONSE_STYLES,
      description: "concise for quick answers, balanced for most agents, detailed when replies need depth.",
    },
    tools: { type: "array", items: { type: "string", enum: AGENT_TOOL_IDS } },
    starters: {
      type: "array",
      items: { type: "string" },
      description: "Up to three short first messages a teammate might send it.",
    },
    color: { type: "string", enum: PERSON_COLORS },
    glyph: { type: "string", enum: AGENT_GLYPHS },
  },
} as const;

const oneOf = <T extends string>(value: string, allowed: readonly T[], fallback: T): T =>
  (allowed as readonly string[]).includes(value) ? (value as T) : fallback;

/** Clamps whatever the architect returned into a draft the form can show as-is. */
export function normalizeDraft(raw: z.output<typeof architectOutputSchema>): AgentDraft {
  const name = raw.name.trim().replace(/\s+/g, " ").slice(0, 40) || "Assistant";
  const handleCandidate = raw.handle.trim().replace(/^@/, "").toLowerCase();
  return {
    name: name.length >= 2 ? name : "Assistant",
    handle: HANDLE_PATTERN.test(handleCandidate) ? handleCandidate : toHandle(name),
    tagline: raw.tagline.trim().replace(/\s+/g, " ").slice(0, 120),
    instructions: raw.instructions.trim().slice(0, 8000),
    knowledge: raw.knowledge.trim().slice(0, MAX_KNOWLEDGE),
    specialty: oneOf(raw.specialty, SPECIALTIES, "assistant"),
    responseStyle: oneOf(raw.responseStyle, RESPONSE_STYLES, "balanced"),
    tools: uniqueTools(raw.tools.filter((tool): tool is AgentToolId => (AGENT_TOOL_IDS as readonly string[]).includes(tool))),
    starters: raw.starters
      .map((starter) => starter.trim().replace(/\s+/g, " "))
      .filter(Boolean)
      .slice(0, MAX_STARTERS)
      .map((starter) => starter.slice(0, 120)),
    color: oneOf(raw.color, PERSON_COLORS, "iris"),
    glyph: oneOf(raw.glyph, AGENT_GLYPHS, "orbit"),
  };
}
