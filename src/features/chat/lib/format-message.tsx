import type { ReactNode } from "react";

/**
 * A deliberately small formatter: ```code blocks```, `inline code`, **bold**,
 * _italic_ and links. Builds React nodes, never HTML strings, so message text
 * can't inject markup.
 */
const TOKEN =
  /(```[\s\S]*?```)|(`[^`\n]+`)|(\*\*[^*\n]+\*\*)|((?<![\w])_[^_\n]+_(?![\w]))|((?:https?:\/\/|www\.)[^\s<]+[^\s<.,:;"')\]!?])/g;

export function formatMessageBody(body: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let cursor = 0;
  let key = 0;

  for (const match of body.matchAll(TOKEN)) {
    const index = match.index ?? 0;
    if (index > cursor) nodes.push(body.slice(cursor, index));
    const [token, block, inline, bold, italic, url] = match;

    if (block) {
      nodes.push(
        <pre
          key={key++}
          className="my-1 overflow-x-auto whitespace-pre rounded-xl bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] px-3 py-2 font-mono text-[13px] leading-relaxed"
        >
          {block.slice(3, -3).replace(/^[\w-]*\n/, "")}
        </pre>,
      );
    } else if (inline) {
      nodes.push(
        <code key={key++} className="rounded-md bg-[color-mix(in_srgb,var(--ink)_7%,transparent)] px-1.5 py-0.5 font-mono text-[0.86em]">
          {inline.slice(1, -1)}
        </code>,
      );
    } else if (bold) {
      nodes.push(
        <strong key={key++} className="font-semibold">
          {bold.slice(2, -2)}
        </strong>,
      );
    } else if (italic) {
      nodes.push(<em key={key++}>{italic.slice(1, -1)}</em>);
    } else if (url) {
      const href = url.startsWith("www.") ? `https://${url}` : url;
      nodes.push(
        <a
          key={key++}
          href={href}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="break-all underline decoration-[color-mix(in_srgb,currentColor_35%,transparent)] underline-offset-2 hover:decoration-current"
        >
          {url}
        </a>,
      );
    }
    cursor = index + token.length;
  }

  if (cursor < body.length) nodes.push(body.slice(cursor));
  return nodes;
}

const EMOJI_ONLY = /^(?:\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier}|‍\p{Extended_Pictographic})*\s*){1,3}$/u;

/** One to three emoji and nothing else get shown big, without a bubble. */
export function isEmojiOnly(body: string) {
  const trimmed = body.trim();
  return trimmed.length > 0 && trimmed.length <= 32 && EMOJI_ONLY.test(trimmed);
}
