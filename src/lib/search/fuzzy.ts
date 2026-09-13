/**
 * Fuzzy ranking for people and chats.
 *
 * Tiers, best first:
 *   1000  exact match
 *    900  prefix of the whole text
 *    800  prefix of a word                ("ok" → "Sam Okafor")
 *    600  substring
 *  ≤ 480  multi-word queries: every word must match somewhere (AND)
 *  ≤ 499  subsequence with bonuses for consecutive runs and word starts
 *                                         ("prn" → "Priya Nair")
 *    250  one typo in a word of four or more letters
 *                                         ("jordn" → "Jordan")
 *      0  no match
 */

const WORD_BOUNDARY = /[\s\-_.@/]/;

export function normalizeText(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function wordStartIndex(text: string, query: string) {
  let from = 0;
  while (from <= text.length - query.length) {
    const index = text.indexOf(query, from);
    if (index === -1) return -1;
    if (index === 0 || WORD_BOUNDARY.test(text[index - 1])) return index;
    from = index + 1;
  }
  return -1;
}

function subsequenceScore(query: string, text: string) {
  let score = 0;
  let cursor = 0;
  let previous = -2;
  let first = -1;

  for (const char of query) {
    const found = text.indexOf(char, cursor);
    if (found === -1) return 0;
    if (first === -1) first = found;
    score += 10;
    if (found === previous + 1) score += 15;
    if (found === 0 || WORD_BOUNDARY.test(text[found - 1])) score += 20;
    score -= Math.min(found - cursor, 5);
    previous = found;
    cursor = found + 1;
  }

  score -= Math.min(first, 20);
  return Math.max(1, Math.min(499, 100 + score));
}

/**
 * Optimal string alignment distance (Levenshtein plus adjacent swaps), giving
 * up as soon as it must exceed `max`.
 */
export function editDistance(a: string, b: string, max = Number.POSITIVE_INFINITY) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp: number[][] = Array.from({ length: rows }, (_, i) => {
    const row = new Array<number>(cols).fill(0);
    row[0] = i;
    return row;
  });
  for (let j = 0; j < cols; j += 1) dp[0][j] = j;

  for (let i = 1; i < rows; i += 1) {
    let rowMin = Number.POSITIVE_INFINITY;
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, dp[i - 2][j - 2] + 1);
      }
      dp[i][j] = value;
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > max) return max + 1;
  }
  return dp[rows - 1][cols - 1];
}

export function fuzzyScore(rawQuery: string, rawText: string): number {
  const query = normalizeText(rawQuery).trim();
  const text = normalizeText(rawText);
  if (!query) return 1;
  if (!text) return 0;

  if (text === query) return 1000;
  if (text.startsWith(query)) return 900 - Math.min(text.length - query.length, 100);

  const wordIndex = wordStartIndex(text, query);
  if (wordIndex >= 0) return 800 - Math.min(wordIndex, 100);

  const substringIndex = text.indexOf(query);
  if (substringIndex >= 0) return 600 - Math.min(substringIndex, 100);

  const tokens = query.split(/\s+/).filter(Boolean);
  if (tokens.length > 1) {
    let total = 0;
    for (const token of tokens) {
      const score = fuzzyScore(token, text);
      if (score === 0) return 0;
      total += score;
    }
    return Math.min(480, Math.round((total / tokens.length) * 0.6));
  }

  const subsequence = subsequenceScore(query, text);
  if (subsequence > 0) return subsequence;

  if (query.length >= 4) {
    for (const word of text.split(WORD_BOUNDARY)) {
      if (word.length < query.length - 1) continue;
      if (editDistance(query, word.slice(0, query.length), 1) <= 1) return 250;
      if (editDistance(query, word, 1) <= 1) return 250;
    }
  }

  return 0;
}

export type WeightedField = readonly [text: string | null | undefined, weight: number];

/** Best weighted score across an item's fields. */
export function scoreFields(query: string, fields: ReadonlyArray<WeightedField>) {
  let best = 0;
  for (const [text, weight] of fields) {
    if (!text) continue;
    best = Math.max(best, fuzzyScore(query, text) * weight);
  }
  return best;
}

/**
 * Filters and orders items by relevance. Ties keep their original order, so
 * callers can pre-sort (for example online people first).
 */
export function rankItems<T>(
  items: ReadonlyArray<T>,
  query: string,
  fields: (item: T) => ReadonlyArray<WeightedField>,
  limit = Number.POSITIVE_INFINITY,
): T[] {
  if (!query.trim()) return items.slice(0, limit);
  return items
    .map((item, index) => ({ item, index, score: scoreFields(query, fields(item)) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map((entry) => entry.item);
}
