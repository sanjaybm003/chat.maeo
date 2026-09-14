/**
 * Picks which earlier messages an agent reads before replying.
 *
 * Long chats don't fit, and the newest messages aren't always the relevant
 * ones. Every message is scored by recency, word overlap with the question,
 * membership in the question's reply chain, and whether it's the agent's own
 * earlier reply or a mention of it. The reply chain and the latest messages
 * always come first; the budget is then filled with the best of the rest, and
 * the result is returned in chronological order with gaps marked.
 */

export interface ContextMessage {
  id: string;
  body: string;
  replyToId: string | null;
  agentId: string | null;
}

export interface SelectOptions {
  agentId: string;
  handle: string;
  /** How many of the newest messages to keep regardless of score. */
  keepRecent?: number;
  maxChars?: number;
  perMessageChars?: number;
}

export interface ContextSelection<T> {
  messages: T[];
  /** Ids of selected messages that follow skipped ones. */
  gapsBefore: Set<string>;
  omitted: number;
}

const STOPWORDS = new Set(
  (
    "the and for are but not you your our ours with this that these those have has had was were will would should could can " +
    "what when where which who whom why how about into from they them their there here then than just also any all some more " +
    "most very been being its let lets get got please thanks thank hey hello know like want need make does did doing done one " +
    "out over such only own same too now yes okay sure let's i'm it's that's we're you're don't can't won't"
  ).split(" "),
);

/** Content words, most frequent first; ties go to longer (usually more specific) words. */
export function keywords(text: string, limit = 12): string[] {
  const counts = new Map<string, number>();
  const cleaned = text.toLowerCase().replace(/https?:\/\/\S+/g, " ").replace(/```[\s\S]*?```/g, " ");
  for (const word of cleaned.split(/[^\p{L}\p{N}'-]+/u)) {
    const token = word.replace(/^['-]+|['-]+$/g, "");
    if (token.length < 3 || STOPWORDS.has(token) || /^\d+$/.test(token)) continue;
    counts.set(token, (counts.get(token) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)
    .slice(0, limit)
    .map(([word]) => word);
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Quick questions read less of the chat, so they start sooner; hard ones read more. */
export function contextBudget(complexity: number) {
  if (complexity < 0.4) return { maxChars: 12_000, keepRecent: 8 };
  if (complexity < 0.68) return { maxChars: 24_000, keepRecent: 12 };
  return { maxChars: 40_000, keepRecent: 16 };
}

export function selectContext<T extends ContextMessage>(
  history: readonly T[],
  question: { body: string; replyToId: string | null },
  options: SelectOptions,
): ContextSelection<T> {
  const keepRecent = options.keepRecent ?? 12;
  const maxChars = options.maxChars ?? 30_000;
  const perMessage = options.perMessageChars ?? 2000;
  const cost = (message: T) => Math.min(message.body.length, perMessage) + 80;

  const indexById = new Map(history.map((message, index) => [message.id, index]));
  const chain = new Set<number>();
  for (let next = question.replyToId; next && indexById.has(next); ) {
    const index = indexById.get(next)!;
    if (chain.has(index)) break;
    chain.add(index);
    next = history[index].replyToId;
  }

  const wanted = new Set(keywords(question.body));
  const mention = new RegExp(`(?<![\\w@])@${escapeRegExp(options.handle)}(?![\\w-])`, "i");
  const scored = history.map((message, index) => {
    const age = history.length - 1 - index;
    const overlap = wanted.size > 0 ? keywords(message.body, 40).filter((word) => wanted.has(word)).length / Math.max(3, wanted.size) : 0;
    // Relevance beats mild recency: a message on the same topic, the agent's own earlier reply or a
    // mention of it matters more than chatter that is merely a few messages old.
    const score =
      0.45 * Math.exp(-age / 18) +
      0.5 * Math.min(1, overlap) +
      (chain.has(index) ? 0.6 : 0) +
      (message.agentId === options.agentId ? 0.35 : 0) +
      (mention.test(message.body) ? 0.35 : 0);
    return { index, score };
  });

  const chosen = new Set<number>();
  let used = 0;
  const take = (index: number) => {
    if (chosen.has(index)) return true;
    const size = cost(history[index]);
    if (used + size > maxChars && chosen.size > 0) return false;
    chosen.add(index);
    used += size;
    return true;
  };

  for (const index of [...chain].sort((a, b) => b - a)) take(index);
  for (let index = history.length - 1; index >= Math.max(0, history.length - keepRecent); index -= 1) {
    if (!take(index)) break;
  }
  for (const { index } of scored.filter((item) => !chosen.has(item.index)).sort((a, b) => b.score - a.score)) {
    take(index);
  }

  const indices = [...chosen].sort((a, b) => a - b);
  const gapsBefore = new Set<string>();
  indices.forEach((index, position) => {
    const previous = position === 0 ? -1 : indices[position - 1];
    if (index - previous > 1) gapsBefore.add(history[index].id);
  });

  return { messages: indices.map((index) => history[index]), gapsBefore, omitted: history.length - indices.length };
}
