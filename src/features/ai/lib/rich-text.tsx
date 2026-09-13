import { Fragment, type ReactNode } from "react";

import { formatMessageBody } from "@/features/chat/lib/format-message";

/**
 * Block formatting for agent replies: headings, lists, quotes, tables, rules
 * and fenced code, with the chat's inline formatter inside each block. Builds
 * React nodes only, so model output can never inject markup.
 */

export type Block =
  | { type: "code"; text: string }
  | { type: "heading"; text: string }
  | { type: "list"; ordered: boolean; start: number; items: string[] }
  | { type: "quote"; lines: string[] }
  | { type: "table"; header: string[]; rows: string[][] }
  | { type: "rule" }
  | { type: "paragraph"; lines: string[] };

const FENCE = /^\s*```/;
const HEADING = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/;
const RULE = /^\s*([-*_])(?:\s*\1){2,}\s*$/;
const BULLET = /^\s*[-*•+]\s+(.*)$/;
const NUMBERED = /^\s*(\d{1,4})[.)]\s+(.*)$/;
const QUOTE = /^\s*>\s?(.*)$/;
const TABLE_DIVIDER = /^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function splitRow(line: string) {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

const isTableStart = (lines: string[], index: number) =>
  lines[index].includes("|") && index + 1 < lines.length && TABLE_DIVIDER.test(lines[index + 1]);

function startsBlock(lines: string[], index: number) {
  const line = lines[index];
  return (
    FENCE.test(line) ||
    HEADING.test(line) ||
    RULE.test(line) ||
    BULLET.test(line) ||
    NUMBERED.test(line) ||
    QUOTE.test(line) ||
    isTableStart(lines, index)
  );
}

export function parseBlocks(text: string): Block[] {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (FENCE.test(line)) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !FENCE.test(lines[index])) body.push(lines[index++]);
      index += 1;
      blocks.push({ type: "code", text: body.join("\n") });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({ type: "heading", text: heading[1] });
      index += 1;
      continue;
    }

    if (RULE.test(line)) {
      blocks.push({ type: "rule" });
      index += 1;
      continue;
    }

    if (isTableStart(lines, index)) {
      const header = splitRow(line);
      const rows: string[][] = [];
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        const cells = splitRow(lines[index++]);
        rows.push(header.map((_, column) => cells[column] ?? ""));
      }
      blocks.push({ type: "table", header, rows });
      continue;
    }

    const numbered = NUMBERED.exec(line);
    if (numbered || BULLET.test(line)) {
      const ordered = Boolean(numbered);
      const pattern = ordered ? NUMBERED : BULLET;
      const items: string[] = [];
      while (index < lines.length && pattern.test(lines[index])) {
        const match = pattern.exec(lines[index++])!;
        let item = ordered ? match[2] : match[1];
        // Indented lines that aren't new items continue the item above.
        while (index < lines.length && /^\s{2,}\S/.test(lines[index]) && !startsBlock(lines, index)) {
          item += ` ${lines[index++].trim()}`;
        }
        items.push(item);
      }
      blocks.push({ type: "list", ordered, start: numbered ? Number(numbered[1]) : 1, items });
      continue;
    }

    if (QUOTE.test(line)) {
      const quoted: string[] = [];
      while (index < lines.length && QUOTE.test(lines[index])) quoted.push(QUOTE.exec(lines[index++])![1]);
      blocks.push({ type: "quote", lines: quoted });
      continue;
    }

    const paragraph: string[] = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !startsBlock(lines, index)) paragraph.push(lines[index++]);
    blocks.push({ type: "paragraph", lines: paragraph });
  }

  return blocks;
}

function Lines({ lines }: { lines: string[] }) {
  return lines.map((line, index) => (
    <Fragment key={index}>
      {index > 0 ? <br /> : null}
      {formatMessageBody(line)}
    </Fragment>
  ));
}

/** `trailing` (a streaming caret) sits at the end of the last line of text, not on a line of its own. */
function renderBlock(block: Block, key: number, trailing: ReactNode): ReactNode {
  switch (block.type) {
    case "code":
      return (
        <Fragment key={key}>
          <pre className="overflow-x-auto whitespace-pre rounded-xl bg-[color-mix(in_srgb,var(--ink)_6%,transparent)] px-3 py-2 font-mono text-[13px] leading-relaxed">
            {block.text}
          </pre>
          {trailing ? <span>{trailing}</span> : null}
        </Fragment>
      );
    case "heading":
      return (
        <p key={key} className="pt-1 font-display text-[15.5px] font-semibold tracking-[-0.01em] text-ink">
          {formatMessageBody(block.text)}
          {trailing}
        </p>
      );
    case "list": {
      const items = block.items.map((item, index) => (
        <li key={index} className="pl-1">
          {formatMessageBody(item)}
          {index === block.items.length - 1 ? trailing : null}
        </li>
      ));
      return block.ordered ? (
        <ol key={key} start={block.start} className="flex list-decimal flex-col gap-1 pl-5 marker:font-mono marker:text-[12.5px] marker:text-ink-3">
          {items}
        </ol>
      ) : (
        <ul key={key} className="flex list-disc flex-col gap-1 pl-5 marker:text-ink-4">
          {items}
        </ul>
      );
    }
    case "quote":
      return (
        <blockquote key={key} className="border-l-[3px] border-line-2 pl-3 text-ink-2">
          <Lines lines={block.lines} />
          {trailing}
        </blockquote>
      );
    case "table":
      return (
        <div key={key} className="-mx-1 overflow-x-auto">
          <table className="w-full border-collapse text-left text-[13.5px]">
            <thead>
              <tr>
                {block.header.map((cell, index) => (
                  <th key={index} className="border-b border-line-2 px-2 py-1.5 font-semibold text-ink">
                    {formatMessageBody(cell)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, rowIndex) => (
                <tr key={rowIndex}>
                  {row.map((cell, index) => (
                    <td key={index} className="border-b border-line px-2 py-1.5 align-top text-ink-2">
                      {formatMessageBody(cell)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {trailing}
        </div>
      );
    case "rule":
      return (
        <Fragment key={key}>
          <hr className="border-line" />
          {trailing ? <span>{trailing}</span> : null}
        </Fragment>
      );
    case "paragraph":
      return (
        <p key={key}>
          <Lines lines={block.lines} />
          {trailing}
        </p>
      );
  }
}

export function RichText({ text, trailing }: { text: string; trailing?: ReactNode }) {
  const blocks = parseBlocks(text);
  return (
    <div className="flex flex-col gap-2 break-words">
      {blocks.map((block, index) => renderBlock(block, index, index === blocks.length - 1 ? trailing : null))}
      {blocks.length === 0 && trailing ? <span>{trailing}</span> : null}
    </div>
  );
}

/** One line of plain text for previews and notifications. */
export function plainText(text: string) {
  return text
    .replace(/```[\s\S]*?(```|$)/g, " [code] ")
    .replace(/^\s{0,3}(#{1,6}|>|[-*•+]|\d{1,4}[.)])\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
