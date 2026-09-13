/**
 * @mentions for agents. A mention is "@handle" at the start of the text or
 * after whitespace/punctuation, and not glued to the next word.
 */

const MENTION = /(?<![\w@])@([a-z][a-z0-9-]{1,22}[a-z0-9])(?![\w-])/gi;

export function extractMentionHandles(body: string, limit = 5): string[] {
  const handles: string[] = [];
  for (const match of body.matchAll(MENTION)) {
    const handle = match[1].toLowerCase();
    if (!handles.includes(handle)) handles.push(handle);
    if (handles.length >= limit) break;
  }
  return handles;
}

export type MentionToken = { type: "text"; value: string } | { type: "mention"; handle: string; raw: string };

/** Splits text into plain runs and mentions of handles that exist. */
export function tokenizeMentions(text: string, isKnown: (handle: string) => boolean): MentionToken[] {
  const tokens: MentionToken[] = [];
  let cursor = 0;
  for (const match of text.matchAll(MENTION)) {
    const handle = match[1].toLowerCase();
    if (!isKnown(handle)) continue;
    const index = match.index ?? 0;
    if (index > cursor) tokens.push({ type: "text", value: text.slice(cursor, index) });
    tokens.push({ type: "mention", handle, raw: match[0] });
    cursor = index + match[0].length;
  }
  if (cursor < text.length) tokens.push({ type: "text", value: text.slice(cursor) });
  return tokens;
}

/** The "@que" being typed at the caret, if any, so the composer can suggest agents. */
export function activeMentionQuery(text: string, caret: number): { query: string; start: number } | null {
  const before = text.slice(0, caret);
  const match = /(?:^|[\s(])@([a-z0-9-]{0,24})$/i.exec(before);
  if (!match) return null;
  const query = match[1];
  return { query: query.toLowerCase(), start: caret - query.length - 1 };
}

/** Replaces the "@que" at `start` with "@handle " and returns the new caret. */
export function insertMention(text: string, caret: number, start: number, handle: string) {
  const inserted = `@${handle} `;
  const after = text.slice(caret).replace(/^[a-z0-9-]*/i, "");
  return { text: text.slice(0, start) + inserted + after.replace(/^ /, ""), caret: start + inserted.length };
}
