/**
 * Small, pure checks that make answers from the web more trustworthy: searches
 * dated to now, better sources first, the passages of a page that bear on the
 * question, and links a reply cites that nothing the agent read contains.
 */

export interface SourceLink {
  title: string;
  url: string;
}

const RECENCY = /\b(?:latest|newest|current(?:ly)?|today|tonight|right now|this (?:week|month|quarter|year)|recent(?:ly)?|upcoming|so far)\b/i;
const YEAR = /\b(?:19|20)\d{2}\b/;

/** "latest iPhone price" searched in 2026 becomes "latest iPhone price 2026", so engines don't lead with last year's pages. */
export function withRecency(query: string, now: Date = new Date()) {
  const trimmed = query.trim();
  return RECENCY.test(trimmed) && !YEAR.test(trimmed) ? `${trimmed} ${now.getUTCFullYear()}` : trimmed;
}

/** Host and path, without scheme, www, query, fragment or trailing slash: how two links to one page are matched. */
export function normalizeUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    return `${parsed.hostname.toLowerCase().replace(/^www\./, "")}${parsed.pathname.replace(/\/+$/, "")}`;
  } catch {
    return null;
  }
}

export function hostLabel(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "source";
  }
}

/** Content farms and social posts: kept, but read last. */
const WEAK_HOSTS = /(?:^|\.)(?:pinterest\.[a-z.]+|quora\.com|facebook\.com|instagram\.com|tiktok\.com|scribd\.com|slideshare\.net|coursehero\.com|answers\.com)$/i;
/** Official and primary sources: governments, universities, standards bodies and product documentation. */
const PRIMARY_HOSTS = /(?:^|\.)(?:gov|edu|mil|int)(?:\.[a-z]{2})?$|^(?:docs|developer|developers|support|help|learn|investor|investors|ir)\./i;

/** One entry per page, primary sources first, weak ones last, otherwise in the engine's order. */
export function rankSources<T extends SourceLink>(sources: readonly T[]): T[] {
  const seen = new Set<string>();
  const unique = sources.filter((source) => {
    const key = normalizeUrl(source.url);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const weight = (source: T) => {
    const host = hostLabel(source.url);
    return WEAK_HOSTS.test(host) ? 2 : PRIMARY_HOSTS.test(host) ? 0 : 1;
  };
  return unique
    .map((source, index) => ({ source, index, weight: weight(source) }))
    .sort((a, b) => a.weight - b.weight || a.index - b.index)
    .map((item) => item.source);
}

const LINK = /https?:\/\/[^\s<>()[\]{}"'`|]+[^\s<>()[\]{}"'`|.,;:!?*_]/gi;

export function extractLinks(text: string): string[] {
  return [...new Set(text.match(LINK) ?? [])];
}

/**
 * Links in a reply to pages that none of the material mentions: the
 * conversation, what was fetched and what tools returned. A link to a site's
 * front page is never flagged, and neither is one to a page whose deeper page
 * was read; a deeper path nobody read is how made-up links usually look.
 */
export function unverifiedLinks(reply: string, material: readonly string[]): string[] {
  const known = new Set(material.flatMap((text) => extractLinks(text).flatMap((url) => normalizeUrl(url) ?? [])));
  return extractLinks(reply).filter((url) => {
    const key = normalizeUrl(url);
    if (!key || !key.includes("/")) return false;
    if (known.has(key)) return false;
    for (const other of known) if (other.startsWith(`${key}/`)) return false;
    return true;
  });
}

const STOPWORDS = new Set(
  "the and for with that this from what when where which who whom whose how why are was were will would can could should about into over than then them they their there these those your yours have has had not but you our out get got its it's does did doing done been being just also more most much many some any each very here only such like".split(
    " ",
  ),
);

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whole words only, so "date" doesn't match "updates", with the common endings: "release" matches "released". */
function queryTerms(query: string) {
  return [...new Set(query.toLowerCase().match(/[a-z0-9À-￿][a-z0-9À-￿.+#-]*/g) ?? [])]
    .map((term) => term.replace(/[.-]+$/, ""))
    .filter((term) => term.length >= 3 && !STOPWORDS.has(term))
    .map((term) => new RegExp(`(?:^|[^a-z0-9À-￿])${escapeRegExp(term)}(?:s|es|d|ed|ing)?(?![a-z0-9À-￿])`, "i"));
}

/**
 * The passages of a page most about the query, in page order, within maxChars.
 * Passages with numbers get a nudge, since dates, prices and figures are
 * usually what a search is after.
 */
export function relevantExcerpt(text: string, query: string, maxChars = 1_800): string {
  const terms = queryTerms(query);
  // Page text keeps one paragraph, heading or list item per line.
  const blocks = text
    .split(/\n+/)
    .map((block) => block.replace(/\s+/g, " ").trim())
    .filter((block) => block.length >= 20);
  if (blocks.length === 0) return text.replace(/\s+/g, " ").trim().slice(0, maxChars);

  const scored = blocks.map((block, index) => {
    const hits = terms.filter((term) => term.test(block)).length;
    return { block: block.length > 700 ? `${block.slice(0, 699)}…` : block, index, score: hits > 0 ? hits + (/\d/.test(block) ? 0.5 : 0) : 0 };
  });

  const chosen: typeof scored = [];
  let used = 0;
  for (const item of [...scored].sort((a, b) => b.score - a.score || a.index - b.index)) {
    // Without a single match, the page's opening is the best guess.
    if (item.score === 0 && chosen.length > 0) break;
    if (used + item.block.length > maxChars) continue;
    chosen.push(item);
    used += item.block.length + 2;
    if (item.score === 0) break;
  }
  return chosen
    .sort((a, b) => a.index - b.index)
    .map((item) => item.block)
    .join("\n\n");
}

/** A short source line for a reply that used the web but linked nothing. */
export function sourcesFooter(reply: string, sources: readonly SourceLink[], max = 3) {
  if (extractLinks(reply).length > 0) return "";
  const picked = rankSources(sources).slice(0, max);
  if (picked.length === 0) return "";
  return `\n\nSources: ${picked.map((source) => `[${hostLabel(source.url)}](${source.url.replace(/\)/g, "%29")})`).join(" · ")}`;
}
