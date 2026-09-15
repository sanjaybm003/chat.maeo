import { hostLabel, normalizeUrl, rankSources } from "./web-evidence";

/**
 * Puts a finished agent reply's links in order. Every link the reply uses that
 * the agent actually read becomes a numbered source, cited in place as [n] and
 * listed once at the end. A link to a page nothing it read mentions loses its
 * address, since that's how made-up links look. A reply built on the web that
 * cites nothing still lists where its facts came from.
 */

export interface ReplySource {
  title: string;
  url: string;
}

export const MAX_REPLY_SOURCES = 8;
const MAX_TITLE = 90;

const FINDING = /^\[\d+\]\s+(.+?)\s+<(https?:\/\/[^>\s]+)>\s*$/gm;
const PAGE = /^Page:\s*(.+)\nURL:\s*(https?:\/\/\S+)/gm;
const EXCERPT = /<source url="(https?:\/\/[^"\s]+)" title="([^"]*)">/g;
const ANY_LINK = /https?:\/\/[^\s<>()[\]{}"'`|]+[^\s<>()[\]{}"'`|.,;:!?*_]/g;

const clean = (title: string) => title.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE);

/**
 * Every page the material points to, with the best title it gives, keyed by
 * normalized address. Sources a search returned count too, with their titles.
 */
export function collectSources(material: readonly string[], searched: readonly ReplySource[] = []): Map<string, ReplySource> {
  const found = new Map<string, ReplySource>();
  const add = (url: string, title: string, specific: boolean) => {
    const key = normalizeUrl(url);
    if (!key) return;
    const current = found.get(key);
    if (!current || (specific && current.title === hostLabel(current.url))) {
      found.set(key, { url, title: clean(title) || hostLabel(url) });
    }
  };
  for (const source of searched) add(source.url, source.title, source.title !== source.url);
  for (const text of material) {
    for (const match of text.matchAll(FINDING)) add(match[2], match[1], true);
    for (const match of text.matchAll(PAGE)) add(match[2], match[1] === match[2] ? hostLabel(match[2]) : match[1], true);
    for (const match of text.matchAll(EXCERPT)) add(match[1], match[2], true);
    for (const match of text.matchAll(ANY_LINK)) add(match[0], hostLabel(match[0]), false);
  }
  return found;
}

const SECTION_HEADING = /^\s*(?:#{1,6}\s*)?(?:\*\*)?(?:sources|references|links|citations|further reading)(?:\*\*)?\s*:?\s*(?:\*\*)?\s*$/i;
const INLINE_SOURCES = /^\s*(?:\*\*)?(?:sources|references)(?:\*\*)?\s*:\s*(.+)$/i;
const MARKDOWN_LINK = /\[((?:\\.|[^\]\\\n]){1,300})\]\((https?:\/\/[^\s)]+)\)/g;
const LINKS_IN_TEXT = new RegExp(`${MARKDOWN_LINK.source}|${ANY_LINK.source}`, "g");

/** A sources section the model wrote itself at the end, removed, with the links it listed. */
function takeTrailingSources(text: string): { body: string; links: string[] } {
  const lines = text.replace(/\s+$/, "").split("\n");
  const linksOf = (line: string) => [...line.matchAll(ANY_LINK)].map((match) => match[0]);

  const last = lines.length - 1;
  const inline = last >= 0 ? INLINE_SOURCES.exec(lines[last]) : null;
  if (inline && linksOf(inline[1]).length > 0) {
    return { body: lines.slice(0, last).join("\n"), links: linksOf(inline[1]) };
  }

  for (let index = last; index >= 0; index -= 1) {
    if (!SECTION_HEADING.test(lines[index])) continue;
    const after = lines.slice(index + 1).filter((line) => line.trim());
    if (after.length === 0 || !after.every((line) => linksOf(line).length > 0)) break;
    return { body: lines.slice(0, index).join("\n"), links: after.flatMap(linksOf) };
  }
  return { body: text, links: [] };
}

/** Link-bearing text only: fenced and inline code are left exactly as written. */
function mapProse(text: string, transform: (prose: string) => string) {
  return text
    .split(/(```[\s\S]*?(?:```|$))/)
    .map((part) => (part.startsWith("```") ? part : part.split(/(`[^`\n]+`)/).map((piece) => (piece.startsWith("`") ? piece : transform(piece))).join("")))
    .join("");
}

export function arrangeSources(
  reply: string,
  { known, fallback = [], max = MAX_REPLY_SOURCES }: { known: ReadonlyMap<string, ReplySource>; fallback?: readonly ReplySource[]; max?: number },
): { text: string; sources: ReplySource[] } {
  const { body, links: listed } = takeTrailingSources(reply);
  const sources: ReplySource[] = [];
  const numbers = new Map<string, number>();

  /**
   * The page a link points to when the agent read it, "front" for a site's
   * front page it didn't (left as written, not listed), or null for a deeper
   * page nothing backs up. A section above a page it read counts as read.
   */
  const lookUp = (url: string): ReplySource | "front" | null => {
    const key = normalizeUrl(url);
    if (!key) return null;
    const exact = known.get(key);
    if (exact) return exact;
    if (!key.includes("/")) return "front";
    for (const [other, source] of known) if (other.startsWith(`${key}/`)) return { url, title: hostLabel(source.url) };
    return null;
  };

  const cite = (source: ReplySource) => {
    const key = normalizeUrl(source.url) ?? source.url;
    const existing = numbers.get(key);
    if (existing) return existing;
    if (sources.length >= max) return null;
    sources.push({ url: source.url, title: clean(source.title) || hostLabel(source.url) });
    numbers.set(key, sources.length);
    return sources.length;
  };

  const text = mapProse(body, (prose) =>
    prose
      .replace(LINKS_IN_TEXT, (whole, label: string | undefined, markdownUrl: string | undefined) => {
        const url = markdownUrl ?? whole;
        const found = lookUp(url);
        if (found === "front") return whole;
        const plainLabel = label?.replace(/\\(.)/g, "$1");
        if (!found) return plainLabel ?? "";
        const number = cite(found);
        const marker = number ? `[${number}]` : "";
        return plainLabel ? `${plainLabel}${marker ? ` ${marker}` : ""}` : marker;
      })
      // A removed address can leave "see ()" or doubled spaces behind.
      .replace(/\(\s*\)/g, "")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/ +([.,;:!?])/g, "$1"),
  );

  for (const url of listed) {
    const found = lookUp(url);
    if (found && found !== "front") cite(found);
  }
  if (sources.length === 0) for (const source of rankSources(fallback).slice(0, 3)) cite(source);

  if (sources.length === 0) return { text: text.trimEnd(), sources };
  const list = sources.map((source, index) => `${index + 1}. [${source.title.replace(/([\\[\]])/g, "\\$1")}](${source.url.replace(/\)/g, "%29")})`);
  return { text: `${text.trimEnd()}\n\n**Sources**\n${list.join("\n")}`, sources };
}

const SOURCES_BLOCK = /\n+\*\*Sources\*\*\n((?:\d{1,2}\. \[(?:\\.|[^\]\\\n])*\]\(https?:\/\/[^\s)]+\)[ \t]*(?:\n|$))+)\s*$/;
const SOURCE_LINE = /^\d{1,2}\. \[((?:\\.|[^\]\\\n])*)\]\((https?:\/\/[^\s)]+)\)/;

/** The reply's text and the numbered source list at its end, for showing them apart. */
export function splitSources(text: string): { body: string; sources: ReplySource[] } {
  const match = SOURCES_BLOCK.exec(text);
  if (!match) return { body: text, sources: [] };
  const sources = match[1].split("\n").flatMap((line) => {
    const source = SOURCE_LINE.exec(line.trim());
    return source ? [{ title: source[1].replace(/\\(.)/g, "$1"), url: source[2] }] : [];
  });
  return { body: text.slice(0, match.index).trimEnd(), sources };
}
