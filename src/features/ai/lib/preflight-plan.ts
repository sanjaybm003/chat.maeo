/**
 * What to fetch before an agent's model starts, so the common cases answer in
 * one round instead of stopping to call tools: links the person shared, tasks
 * named by number, and a web search when a question plainly needs the outside
 * world. Everything here is a cheap guess; the agent can still use its tools.
 */

export interface PreflightPlan {
  webQuery: string | null;
  links: string[];
  taskNumbers: number[];
}

const URL_PATTERN = /https?:\/\/[^\s<>()"'`]+[^\s<>()"'`.,;:!?]/gi;
const TASK_REFERENCE = /(?<![\w-])T-(\d{1,6})\b/gi;
const MENTION = /(?<![\w@])@[a-z][a-z0-9-]{1,22}[a-z0-9]/gi;

/** Signals of facts from outside the team. */
const OUTSIDE = /\b(?:news|latest|newest|recent(?:ly)?|current(?:ly)?|right now|this (?:week|month|year)|price|prices|pricing|cost of|exchange rate|stocks?|share price|weather|released?|release date|launch(?:ed)?|announce(?:d|ment)?|version|20[2-9]\d)\b/i;
/** Signals that the answer lives in the team's own conversations. */
const INTERNAL = /\b(?:we|our|ours|us|team|decided|agreed|chat|meeting|standup|you said|earlier|T-\d+)\b/i;
const QUESTION = /\?|^\s*(?:what|what's|who|when|where|which|how|is|are|does|did|can|could|find|search|look up|check)\b/i;

/** The message as a search: no mentions, links, code or line breaks. */
export function searchQueryFrom(text: string) {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(MENTION, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
}

/** A question about the outside world that doesn't point at the team's own work. */
export function wantsWebResearch(text: string) {
  const query = searchQueryFrom(text);
  return OUTSIDE.test(query) && QUESTION.test(query) && !INTERNAL.test(query) && query.split(" ").length >= 3;
}

export function planPreflight(
  text: string,
  options: { tools: readonly string[]; searchAvailable: boolean; nativeWebSearch: boolean },
): PreflightPlan {
  const canUseWeb = options.tools.includes("web");
  const links = canUseWeb ? [...new Set(text.match(URL_PATTERN) ?? [])].slice(0, 2) : [];
  const taskNumbers = [...new Set([...text.matchAll(TASK_REFERENCE)].map((match) => Number(match[1])))].slice(0, 5);
  const webQuery =
    canUseWeb && options.searchAvailable && !options.nativeWebSearch && links.length === 0 && wantsWebResearch(text)
      ? searchQueryFrom(text)
      : null;
  return { webQuery, links, taskNumbers };
}
