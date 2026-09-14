import type { Agent, Member, TaskPriority } from "@/types/domain";

import { addDays, dateFromParts, isoDate, nextWeekday } from "./dates";

/**
 * Turns "/task Fix the login bug @priya tomorrow !high" into a task: its title,
 * who does it, when it's due and how urgent it is. What it recognizes is lifted
 * out of the title; anything it doesn't recognize stays in the title as typed.
 */

export const TASK_COMMAND = /^\/(?:task|todo)(?:\s+([\s\S]*))?$/i;

export type QuickAssignee = { kind: "person"; id: string } | { kind: "agent"; id: string };

export interface QuickTask {
  title: string;
  assignee: QuickAssignee | null;
  /** An "@name" that matched nobody, so the message bar can say so before creating. */
  unknownMention: string | null;
  dueOn: string | null;
  priority: TaskPriority | null;
}

export interface QuickTaskDirectory {
  members: readonly Member[];
  agents: readonly Agent[];
}

const WEEKDAY_WORDS: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tues: 2, tuesday: 2,
  wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};

const MONTH_WORDS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";
const LEAD = "(?:(?:due|by|on)\\s+)?";

const PRIORITY_WORDS: Record<string, TaskPriority> = {
  "!urgent": "urgent",
  "!high": "high",
  "!medium": "medium",
  "!med": "medium",
  "!low": "low",
  p0: "urgent",
  p1: "high",
  p2: "medium",
  p3: "low",
};

const monthIndex = (word: string) => MONTH_WORDS.indexOf(word.slice(0, 3).toLowerCase());

/** A day and month without a year means the next time that date comes round. */
function upcoming(today: Date, monthIdx: number, day: number, year?: number) {
  if (year) return dateFromParts(year, monthIdx, day);
  const thisYear = dateFromParts(today.getFullYear(), monthIdx, day);
  if (thisYear && isoDate(thisYear) >= isoDate(today)) return thisYear;
  return dateFromParts(today.getFullYear() + 1, monthIdx, day);
}

type DateRule = { pattern: RegExp; resolve: (match: RegExpExecArray, today: Date) => Date | null };

const DATE_RULES: DateRule[] = [
  {
    pattern: new RegExp(`\\b${LEAD}(\\d{4})-(\\d{2})-(\\d{2})\\b`, "i"),
    resolve: (m) => dateFromParts(Number(m[1]), Number(m[2]) - 1, Number(m[3])),
  },
  {
    pattern: new RegExp(`\\b${LEAD}(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH}(?:\\s+(\\d{4}))?(?![\\w-])`, "i"),
    resolve: (m, today) => upcoming(today, monthIndex(m[2]), Number(m[1]), m[3] ? Number(m[3]) : undefined),
  },
  {
    pattern: new RegExp(`\\b${LEAD}${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?(?![\\w-])`, "i"),
    resolve: (m, today) => upcoming(today, monthIndex(m[1]), Number(m[2]), m[3] ? Number(m[3]) : undefined),
  },
  {
    pattern: new RegExp(`\\b${LEAD}(today|tonight|tomorrow|tmrw|tmr)\\b`, "i"),
    resolve: (m, today) => (/^to(day|night)$/i.test(m[1]) ? today : addDays(today, 1)),
  },
  {
    pattern: /\b(?:(?:due|by)\s+)?in\s+(\d{1,3})\s+(days?|weeks?)\b/i,
    resolve: (m, today) => addDays(today, Number(m[1]) * (m[2].toLowerCase().startsWith("week") ? 7 : 1)),
  },
  {
    pattern: /\b(?:by\s+)?(?:(?:the\s+)?end\s+of\s+(?:the\s+)?week|eow)\b/i,
    resolve: (_m, today) => (today.getDay() === 5 ? today : nextWeekday(today, 5)),
  },
  {
    pattern: /\bnext\s+week\b/i,
    resolve: (_m, today) => nextWeekday(today, 1),
  },
  {
    pattern: new RegExp(`\\b${LEAD}(next\\s+)?(${Object.keys(WEEKDAY_WORDS).sort((a, b) => b.length - a.length).join("|")})\\b`, "i"),
    resolve: (m, today) => addDays(nextWeekday(today, WEEKDAY_WORDS[m[2].toLowerCase()]), m[1] ? 7 : 0),
  },
];

function takeDate(text: string, today: Date): { text: string; dueOn: string | null } {
  for (const rule of DATE_RULES) {
    const match = rule.pattern.exec(text);
    if (!match) continue;
    const date = rule.resolve(match, today);
    if (!date) continue;
    return { text: `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}`, dueOn: isoDate(date) };
  }
  return { text, dueOn: null };
}

function takePriority(text: string): { text: string; priority: TaskPriority | null } {
  const match = /(^|\s)(!urgent|!high|!medium|!med|!low|p[0-3])(?=\s|$)/i.exec(text);
  if (!match) return { text, priority: null };
  return {
    text: `${text.slice(0, match.index)}${match[1]}${text.slice(match.index + match[0].length)}`,
    priority: PRIORITY_WORDS[match[2].toLowerCase()],
  };
}

const squash = (value: string) => value.toLowerCase().replace(/[\s._-]+/g, "");

/** "@priya", "@priya.s", "@psharma" or an agent's "@handle": exact first, then a single unambiguous prefix. */
export function resolveMention(token: string, { members, agents }: QuickTaskDirectory): QuickAssignee | null {
  const wanted = token.toLowerCase().replace(/[._-]+$/, "");
  if (!wanted) return null;

  const agent = agents.find((item) => !item.archivedAt && item.handle === wanted);
  if (agent) return { kind: "agent", id: agent.id };

  const key = squash(wanted);
  const keysOf = (member: Member) =>
    [member.displayName, member.fullName, member.fullName?.split(/\s+/)[0], member.email.split("@")[0]]
      .filter((value): value is string => Boolean(value))
      .map(squash);

  const exact = members.filter((member) => keysOf(member).includes(key));
  if (exact.length === 1) return { kind: "person", id: exact[0].id };
  if (exact.length > 1 || key.length < 2) return null;

  const partial = members.filter((member) => keysOf(member).some((candidate) => candidate.startsWith(key)));
  return partial.length === 1 ? { kind: "person", id: partial[0].id } : null;
}

export function parseQuickTask(input: string, directory: QuickTaskDirectory, today: Date = new Date()): QuickTask {
  let text = ` ${input.replace(/\s+/g, " ")} `;

  const dated = takeDate(text, today);
  text = dated.text;
  const prioritized = takePriority(text);
  text = prioritized.text;

  let assignee: QuickAssignee | null = null;
  let unknownMention: string | null = null;
  text = text.replace(/(^|\s)@([\p{L}\p{N}][\p{L}\p{N}._-]*)/gu, (whole, space: string, token: string) => {
    if (assignee) return whole;
    const found = resolveMention(token, directory);
    if (found) {
      assignee = found;
      return space;
    }
    unknownMention ??= token;
    return whole;
  });

  const title = text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[-–—:,;]+\s*|\s*[-–—:,;]+$/g, "")
    .trim();

  return { title, assignee, unknownMention: assignee ? null : unknownMention, dueOn: dated.dueOn, priority: prioritized.priority };
}
