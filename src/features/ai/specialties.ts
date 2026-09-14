import {
  SPECIALTIES,
  type AgentGlyph,
  type AgentToolId,
  type PersonColor,
  type ResponseStyle,
  type Specialty,
} from "@/types/domain";

import type { AiProvider, ModelStrength } from "./models";

/**
 * What each kind of agent is for, and the defaults that make it good at it.
 * The working method written into its prompt lives server-side in
 * server/specialty-prompts.ts.
 */
export interface SpecialtyProfile {
  id: Specialty;
  label: string;
  summary: string;
  glyph: AgentGlyph;
  color: PersonColor;
  tools: AgentToolId[];
  style: ResponseStyle;
  /** Where automatic model routing starts before reading the request: 0 is simple, 1 is demanding. */
  baseline: number;
  /** Only sent to models that accept sampling settings. */
  temperature: number;
  /** Provider preference when several models fit the same tier. */
  providers: AiProvider[];
  /** What automatic routing looks for in a model, after the provider preference. */
  strengths: ModelStrength[];
}

export const SPECIALTY_PROFILES: Record<Specialty, SpecialtyProfile> = {
  assistant: {
    id: "assistant",
    label: "Assistant",
    summary: "Everyday questions, quick answers and small tasks.",
    glyph: "spark",
    color: "cobalt",
    tools: ["history", "directory"],
    style: "balanced",
    baseline: 0.3,
    temperature: 0.6,
    providers: ["anthropic", "google", "openai", "deepseek", "bedrock"],
    strengths: [],
  },
  research: {
    id: "research",
    label: "Research",
    summary: "Finds facts in the team’s chats and on the web, with sources.",
    glyph: "orbit",
    color: "lagoon",
    tools: ["history", "search", "web"],
    style: "balanced",
    baseline: 0.55,
    temperature: 0.3,
    providers: ["anthropic", "google", "openai", "deepseek", "bedrock"],
    strengths: ["reasoning", "tools"],
  },
  writing: {
    id: "writing",
    label: "Writing",
    summary: "Drafts, rewrites and polishes messages, docs and posts.",
    glyph: "wave",
    color: "bubblegum",
    tools: ["history"],
    style: "balanced",
    baseline: 0.45,
    temperature: 0.8,
    providers: ["openai", "anthropic", "google", "deepseek", "bedrock"],
    strengths: ["writing"],
  },
  analysis: {
    id: "analysis",
    label: "Analysis",
    summary: "Works through numbers, options and trade-offs.",
    glyph: "prism",
    color: "iris",
    tools: ["history", "search"],
    style: "detailed",
    baseline: 0.62,
    temperature: 0.2,
    providers: ["anthropic", "google", "openai", "deepseek", "bedrock"],
    strengths: ["reasoning"],
  },
  planning: {
    id: "planning",
    label: "Planning",
    summary: "Turns discussion into plans, owners and next steps.",
    glyph: "grid",
    color: "saffron",
    tools: ["history", "search", "directory"],
    style: "balanced",
    baseline: 0.5,
    temperature: 0.4,
    providers: ["anthropic", "openai", "google", "deepseek", "bedrock"],
    strengths: ["tools", "reasoning"],
  },
  support: {
    id: "support",
    label: "Support",
    summary: "Walks people through problems, patiently and step by step.",
    glyph: "bloom",
    color: "grass",
    tools: ["history", "search"],
    style: "concise",
    baseline: 0.3,
    temperature: 0.4,
    providers: ["anthropic", "google", "openai", "deepseek", "bedrock"],
    strengths: ["writing"],
  },
  engineering: {
    id: "engineering",
    label: "Engineering",
    summary: "Explains, reviews and writes code.",
    glyph: "prism",
    color: "clay",
    tools: ["history", "search"],
    style: "balanced",
    baseline: 0.62,
    temperature: 0.2,
    providers: ["anthropic", "openai", "google", "deepseek", "bedrock"],
    strengths: ["code", "tools"],
  },
};

export const SPECIALTY_LIST: readonly SpecialtyProfile[] = SPECIALTIES.map((id) => SPECIALTY_PROFILES[id]);

/** Database strings are checked on the way in, but stay defensive about what's stored. */
export const toSpecialty = (value: string | null | undefined): Specialty =>
  (SPECIALTIES as readonly string[]).includes(value ?? "") ? (value as Specialty) : "assistant";

export const toResponseStyle = (value: string | null | undefined): ResponseStyle =>
  value === "concise" || value === "detailed" ? value : "balanced";

export const RESPONSE_STYLE_OPTIONS: Record<ResponseStyle, { label: string; summary: string }> = {
  concise: { label: "Concise", summary: "A few sentences, straight to the point." },
  balanced: { label: "Balanced", summary: "Focused, with detail where it helps." },
  detailed: { label: "Detailed", summary: "Thorough, structured and explained." },
};
