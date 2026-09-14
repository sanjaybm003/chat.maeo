/**
 * What an app posted to an incoming webhook, in the shapes other chat tools
 * accept, so a link built for Slack or Discord works here unchanged: Slack's
 * `text`, blocks and attachments, Discord's `content`, a plain `message`, a
 * form post, or a plain text body.
 */

export interface IncomingPost {
  text: string;
  /** The name the app asked to post as, if it gave one. */
  name: string | null;
}

export const MAX_INCOMING_TEXT = 4_000;

type JsonRecord = Record<string, unknown>;
const isRecord = (value: unknown): value is JsonRecord => typeof value === "object" && value !== null && !Array.isArray(value);
const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;

function blockText(block: unknown): string[] {
  if (!isRecord(block)) return [];
  const own = isRecord(block.text) && nonEmpty(block.text.text) ? [block.text.text] : [];
  const fields = Array.isArray(block.fields) ? block.fields.flatMap((field) => (isRecord(field) && nonEmpty(field.text) ? [field.text] : [])) : [];
  const elements = Array.isArray(block.elements)
    ? block.elements.flatMap((element) => (isRecord(element) && nonEmpty(element.text) ? [element.text] : isRecord(element) && isRecord(element.text) && nonEmpty(element.text.text) ? [element.text.text] : []))
    : [];
  return [...own, ...fields, ...elements];
}

function richText(record: JsonRecord) {
  const blocks = Array.isArray(record.blocks) ? record.blocks.flatMap(blockText) : [];
  const attachments = Array.isArray(record.attachments)
    ? record.attachments.flatMap((attachment) =>
        isRecord(attachment) ? [attachment.pretext, attachment.title, attachment.text ?? attachment.fallback].filter(nonEmpty) : [],
      )
    : [];
  const embeds = Array.isArray(record.embeds)
    ? record.embeds.flatMap((embed) => (isRecord(embed) ? [embed.title, embed.description].filter(nonEmpty) : []))
    : [];
  const lines = [...blocks, ...attachments, ...embeds];
  return lines.length > 0 ? lines.join("\n") : null;
}

const clip = (text: string) => text.trim().slice(0, MAX_INCOMING_TEXT);
const clipName = (name: unknown) => (nonEmpty(name) ? name.trim().slice(0, 60) : null);

function fromRecord(record: JsonRecord): IncomingPost | null {
  const text = [record.text, record.content, record.message, record.body].find(nonEmpty) ?? richText(record);
  if (!text) return null;
  return { text: clip(text), name: clipName(record.username ?? record.name ?? record.source) };
}

export function parseIncoming(raw: string, contentType: string | null): IncomingPost | null {
  const body = raw.trim();
  if (!body) return null;
  const type = contentType ?? "";

  if (/json/i.test(type) || body.startsWith("{")) {
    try {
      const data: unknown = JSON.parse(body);
      return isRecord(data) ? fromRecord(data) : null;
    } catch {
      // Declared JSON that isn't is a mistake worth reporting; an unlabelled body is just text.
      return /json/i.test(type) ? null : { text: clip(body), name: null };
    }
  }

  if (/x-www-form-urlencoded/i.test(type)) {
    const form = new URLSearchParams(body);
    const payload = form.get("payload");
    if (payload) return parseIncoming(payload, "application/json");
    const text = form.get("text") ?? form.get("message") ?? form.get("content");
    return nonEmpty(text) ? { text: clip(text), name: clipName(form.get("username")) } : null;
  }

  return { text: clip(body), name: null };
}
