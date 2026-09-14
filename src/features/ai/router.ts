import type { ModelMode, ResponseStyle, Specialty } from "@/types/domain";

import { typicalReplyCredits } from "./credits";
import { findModel, type AiModel, type ModelTier } from "./models";
import { SPECIALTY_PROFILES } from "./specialties";

/**
 * Chooses the model for one agent reply.
 *
 *   1. A model the person picked for this message wins.
 *   2. Otherwise an agent pinned to a model uses it, if it's available.
 *   3. Otherwise the request is scored for complexity (the agent's specialty
 *      sets the baseline; length, reasoning cues, code and reply style move
 *      it) and mapped to a tier: fast, balanced or deep. Within the tier the
 *      specialty's preferred providers come first, and web-capable models come
 *      first when the agent can search and the request needs current facts.
 *   4. A thin wallet steps the choice down a tier at a time, so a few credits
 *      still buy answers instead of one expensive one.
 */

const TIERS: readonly ModelTier[] = ["fast", "balanced", "deep"];

const DEEP_SIGNALS =
  /\b(?:analy[sz]e|analysis|compare|comparison|trade-?offs?|pros and cons|strateg(?:y|ic)|architecture|debug|root cause|evaluate|assess|forecast|calculate|estimate|investigate|research|in[- ]depth|step[- ]by[- ]step|review|refactor|design|optimi[sz]e|roadmap|prioriti[sz]e|diagnose|explain why)\b/g;
const LIGHT_SIGNALS =
  /\b(?:thanks|thank you|hi|hello|hey|tl;?dr|one line|quick(?:ly)?|short(?:er)?|briefly|translate|rephrase|reword|typo|spelling|grammar)\b/g;
const FRESH_SIGNALS =
  /\b(?:latest|today|tonight|this (?:week|month|year)|news|current(?:ly)?|right now|prices?|pricing|released?|announce[sd]?|weather|stocks?|20[2-9]\d)\b/i;

/** Step down while a typical reply would cost more than this share of the wallet. */
const LOW_BALANCE_REPLIES = 8;

export type RouteMode = "auto" | "fixed" | "override";

export interface RouteRequest {
  text: string;
  specialty: Specialty;
  style: ResponseStyle;
  mode: ModelMode;
  agentModel: string;
  /** A model id picked for this one message, or "auto"/null. */
  override?: string | null;
  /** The agent has the web search tool. */
  wantsWeb?: boolean;
  balance?: number | null;
  available: readonly AiModel[];
}

export interface RouteDecision {
  model: AiModel;
  mode: RouteMode;
  tier: ModelTier;
  complexity: number;
  reason: string;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const distinctMatches = (text: string, pattern: RegExp) => new Set(text.match(pattern) ?? []).size;

export function scoreComplexity(text: string, specialty: Specialty, style: ResponseStyle) {
  const lower = text.toLowerCase();
  const words = lower.split(/\s+/).filter(Boolean).length;
  let score = SPECIALTY_PROFILES[specialty].baseline;

  if (words > 150) score += 0.25;
  else if (words > 60) score += 0.14;
  else if (words <= 6) score -= 0.12;

  const deep = distinctMatches(lower, DEEP_SIGNALS);
  const light = distinctMatches(lower, LIGHT_SIGNALS);
  score += Math.min(deep, 3) * 0.1;
  if (light > 0 && deep === 0) score -= 0.15;

  if (text.includes("```")) score += 0.15;
  if ((text.match(/\?/g) ?? []).length >= 2) score += 0.05;
  if (style === "detailed") score += 0.08;
  else if (style === "concise") score -= 0.08;

  return Math.round(clamp01(score) * 100) / 100;
}

export function tierForComplexity(complexity: number): ModelTier {
  return complexity < 0.4 ? "fast" : complexity < 0.68 ? "balanced" : "deep";
}

export const needsFreshFacts = (text: string) => FRESH_SIGNALS.test(text);

function bestInTier(tier: ModelTier, available: readonly AiModel[], specialty: Specialty, preferWeb: boolean) {
  const providers = SPECIALTY_PROFILES[specialty].providers;
  const rank = (model: AiModel) => {
    const provider = providers.indexOf(model.provider);
    return (preferWeb && !model.webSearch ? 100 : 0) + (provider === -1 ? 50 : provider) + (model.preview ? 5 : 0);
  };
  return available.filter((model) => model.tier === tier).sort((a, b) => rank(a) - rank(b))[0] ?? null;
}

/** The same tier if possible, then the cheaper neighbour, then the stronger one. */
function nearestModel(tier: ModelTier, available: readonly AiModel[], specialty: Specialty, preferWeb: boolean) {
  const index = TIERS.indexOf(tier);
  for (const candidate of [index, index - 1, index + 1, index - 2, index + 2]) {
    if (candidate < 0 || candidate >= TIERS.length) continue;
    const model = bestInTier(TIERS[candidate], available, specialty, preferWeb);
    if (model) return model;
  }
  return null;
}

/** What automatic routing uses for a tier with this specialty, before wallet and web considerations. */
export function modelForTier(tier: ModelTier, specialty: Specialty, available: readonly AiModel[]) {
  return nearestModel(tier, available, specialty, false);
}

/**
 * The stand-in when the account can't use a model: another model of the same
 * tier if there is one, otherwise the nearest tier, never one already tried.
 */
export function fallbackModel(current: AiModel, specialty: Specialty, available: readonly AiModel[], tried: ReadonlySet<string>) {
  return nearestModel(
    current.tier,
    available.filter((model) => !tried.has(model.id)),
    specialty,
    false,
  );
}

const TIER_REASON: Record<ModelTier, string> = {
  fast: "a quick request",
  balanced: "an everyday request",
  deep: "a request that needs careful reasoning",
};

export function routeModel(request: RouteRequest): RouteDecision | null {
  const { available } = request;
  if (available.length === 0) return null;
  const availableById = (id: string | null | undefined) => (id ? (available.find((model) => model.id === id) ?? null) : null);
  const complexity = scoreComplexity(request.text, request.specialty, request.style);

  if (request.override && request.override !== "auto") {
    const chosen = availableById(request.override);
    if (chosen) {
      return { model: chosen, mode: "override", tier: chosen.tier, complexity, reason: `${chosen.label}, chosen for this message` };
    }
  }

  if (request.mode === "fixed") {
    const pinned = availableById(request.agentModel);
    if (pinned) {
      return { model: pinned, mode: "fixed", tier: pinned.tier, complexity, reason: `${pinned.label}, set for this agent` };
    }
  }

  const preferWeb = Boolean(request.wantsWeb) && needsFreshFacts(request.text);
  const wanted = tierForComplexity(complexity);
  let model = nearestModel(wanted, available, request.specialty, preferWeb);
  let saving = false;

  while (model && request.balance != null && typicalReplyCredits(model) * LOW_BALANCE_REPLIES > request.balance) {
    const index = TIERS.indexOf(model.tier);
    if (index === 0) break;
    const cheaper = nearestModel(TIERS[index - 1], available, request.specialty, preferWeb);
    if (!cheaper || TIERS.indexOf(cheaper.tier) >= index) break;
    model = cheaper;
    saving = true;
  }
  if (!model) return null;

  const unavailable = request.mode === "fixed" ? `${findModel(request.agentModel)?.label ?? "The agent’s model"} is unavailable. ` : "";
  const extras = `${saving ? ", saving credits" : ""}${preferWeb && model.webSearch ? ", with web search" : ""}`;
  return {
    model,
    mode: "auto",
    tier: model.tier,
    complexity,
    reason: `${unavailable}Auto picked ${model.label} for ${TIER_REASON[wanted]}${extras}`,
  };
}
