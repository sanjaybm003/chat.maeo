import "server-only";

import { logger } from "@/lib/logger";
import type { AgentRunStep } from "@/types/domain";

import type { AgentToolId } from "../agent-spec";
import type { AdminClient, NameDirectory } from "./directory";
import { describeGithubToolCall, executeGithubTool, GITHUB_TOOL_NAMES, GITHUB_TOOL_SPECS, type GithubAccess } from "./github-tools";
import type { ToolCall, ToolResult, ToolSpec } from "./providers/types";
import { describeTaskToolCall, executeTaskTool, TASK_TOOL_NAMES, TASK_TOOL_SPECS } from "./task-tools";
import { ToolInputError } from "./tool-errors";
import { formatTranscript, TRANSCRIPT_COLUMNS, type TranscriptMessage } from "./transcript";
import { formatFindings, formatPage, readWebPage, searchWeb, webSearchAvailable, WebToolError } from "./web";

const log = logger.child({ module: "agent-tools" });

const DEFAULT_OUTPUT_CHARS = 8000;
const OUTPUT_CHARS: Record<string, number> = {
  read_web_page: 15_000,
  github_read_file: 26_000,
  github_list_files: 14_000,
};
/** A web search holds this many credits while it runs, then settles at what it really cost. */
const WEB_SEARCH_HOLD = 60;

const HISTORY: ToolSpec = {
  name: "read_earlier_messages",
  description:
    "Read messages from this conversation that are older than the ones you were given. Use it when the answer depends on something said earlier.",
  parameters: {
    type: "object",
    properties: {
      limit: { type: "integer", description: "How many older messages to read, from 1 to 50.", minimum: 1, maximum: 50 },
    },
  },
};

const SEARCH: ToolSpec = {
  name: "search_workspace_messages",
  description:
    "Search messages across the workspace. Only messages that everyone in this conversation can already see are returned. Gives the best matches with who said them, where and when. Use short, specific keywords.",
  parameters: {
    type: "object",
    properties: { query: { type: "string", description: "Two to four specific keywords to look for." } },
    required: ["query"],
  },
};

const DIRECTORY: ToolSpec = {
  name: "list_workspace_members",
  description: "List everyone in this workspace with their name, job title, role and status.",
  parameters: { type: "object", properties: {} },
};

const SEARCH_WEB: ToolSpec = {
  name: "search_web",
  description:
    "Search the web for current or outside information: news, prices, releases, documentation, public facts. Returns a short brief with numbered sources. Make the query specific, with the names and year that matter.",
  parameters: {
    type: "object",
    properties: { query: { type: "string", description: "A specific search, like \"Next.js 16 release date\"." } },
    required: ["query"],
  },
};

const READ_WEB_PAGE: ToolSpec = {
  name: "read_web_page",
  description: "Read the text of one public web page: a link someone shared, or a source you want to check in detail.",
  parameters: {
    type: "object",
    properties: { url: { type: "string", description: "The full https:// address." } },
    required: ["url"],
  },
};

export interface ToolOptions {
  /** The model has its own web search, so only the page reader is added. */
  nativeWebSearch: boolean;
  github: GithubAccess | null;
}

/** The function tools an agent gets for one reply, from the tools switched on for it. */
export function toolsFor(toolIds: readonly string[], options: ToolOptions): ToolSpec[] {
  const has = (id: AgentToolId) => toolIds.includes(id);
  const specs: ToolSpec[] = [];
  if (has("history")) specs.push(HISTORY);
  if (has("search")) specs.push(SEARCH);
  if (has("directory")) specs.push(DIRECTORY);
  if (has("web")) {
    if (!options.nativeWebSearch && webSearchAvailable()) specs.push(SEARCH_WEB);
    specs.push(READ_WEB_PAGE);
  }
  if (has("tasks")) specs.push(...TASK_TOOL_SPECS);
  if (has("github") && options.github) specs.push(...GITHUB_TOOL_SPECS);
  return specs;
}

export interface ToolBilling {
  /** Holds credits before paid work; false when the person asking can't cover it. */
  hold: (credits: number) => Promise<boolean>;
  /** Charges what the work really cost and releases the rest of the hold. */
  settle: (credits: number) => Promise<void>;
}

export interface ToolContext {
  admin: AdminClient;
  directory: NameDirectory;
  workspaceId: string;
  conversationId: string;
  userId: string;
  agentId: string;
  agentName: string;
  /** Moves back each time read_earlier_messages pages further. */
  oldestLoadedAt: string | null;
  github: GithubAccess | null;
  billing: ToolBilling;
  signal: AbortSignal;
}

const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
};

const words = (value: unknown, max = 60) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");

const cap = (text: string, max: number) => (text.length > max ? `${text.slice(0, max)}\n…(truncated)` : text);

function hostOf(value: unknown) {
  try {
    return new URL(String(value)).hostname.replace(/^www\./, "");
  } catch {
    return "a web page";
  }
}

/** What the people in the chat see while the agent works. */
export function describeToolCall(call: ToolCall): AgentRunStep {
  switch (call.name) {
    case HISTORY.name:
      return { kind: "tool", label: "Reading earlier messages" };
    case SEARCH.name: {
      const query = words(call.input.query);
      return { kind: "tool", label: query ? `Searching for “${query}”` : "Searching the workspace" };
    }
    case DIRECTORY.name:
      return { kind: "tool", label: "Looking up the team" };
    case SEARCH_WEB.name: {
      const query = words(call.input.query);
      return { kind: "web", label: query ? `Searching the web for “${query}”` : "Searching the web" };
    }
    case READ_WEB_PAGE.name:
      return { kind: "web", label: `Reading ${hostOf(call.input.url)}` };
    default:
      return describeTaskToolCall(call) ?? describeGithubToolCall(call) ?? { kind: "tool", label: "Working" };
  }
}

async function readEarlierMessages(call: ToolCall, context: ToolContext): Promise<string> {
  if (!context.oldestLoadedAt) return "There are no earlier messages in this conversation.";
  const limit = clamp(call.input.limit, 1, 50, 20);
  const { data, error } = await context.admin
    .from("messages")
    .select(TRANSCRIPT_COLUMNS)
    .eq("conversation_id", context.conversationId)
    .lt("created_at", context.oldestLoadedAt)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;

  const messages = [...((data ?? []) as TranscriptMessage[])].reverse();
  if (messages.length === 0) return "There are no earlier messages in this conversation.";
  context.oldestLoadedAt = messages[0].created_at;

  const lines = formatTranscript(messages, context.directory);
  const more = messages.length === limit ? "\n(Even older messages exist.)" : "";
  return `${lines.join("\n")}${more}`;
}

interface SearchScope {
  admin: AdminClient;
  directory: NameDirectory;
  workspaceId: string;
  conversationId: string;
  userId: string;
}

/** Ranked hits the whole audience of this conversation may read, as transcript-style lines. */
async function searchLines(context: SearchScope, query: string, options: { limit: number; otherChatsOnly: boolean }) {
  // The reply is read by everyone in this conversation, so results are limited to what they can all see.
  const { data, error } = await context.admin.rpc("ai_search_messages_for", {
    p_user_id: context.userId,
    p_workspace_id: context.workspaceId,
    p_audience_conversation_id: context.conversationId,
    p_query: query,
    p_limit: options.limit + (options.otherChatsOnly ? 10 : 0),
  });
  if (error) throw error;
  const hits = (data ?? [])
    .filter((hit) => !options.otherChatsOnly || hit.conversation_id !== context.conversationId)
    .slice(0, options.limit);
  if (hits.length === 0) return [];

  const conversationIds = [...new Set(hits.map((hit) => hit.conversation_id))];
  const { data: conversations } = await context.admin
    .from("conversations")
    .select("id, name, kind, agent_id")
    .in("id", conversationIds);
  const titles = new Map(
    (conversations ?? []).map((conversation) => [
      conversation.id,
      conversation.name
        ? `“${conversation.name}”`
        : conversation.id === context.conversationId
          ? "this chat"
          : conversation.agent_id
            ? "an agent chat"
            : conversation.kind === "direct"
              ? "a direct chat"
              : "a group chat",
    ]),
  );

  return hits.map((hit) => {
    const snippet = hit.body.replace(/\s+/g, " ").slice(0, 300);
    return `- ${hit.created_at.slice(0, 10)} · ${context.directory.authorName(hit)} in ${titles.get(hit.conversation_id) ?? "a chat"}: ${snippet}`;
  });
}

async function searchWorkspace(call: ToolCall, context: ToolContext): Promise<string> {
  const query = typeof call.input.query === "string" ? call.input.query.trim().slice(0, 200) : "";
  if (query.length < 2) return "Give a search query of at least two characters.";
  const lines = await searchLines(context, query, { limit: 10, otherChatsOnly: false });
  return lines.length > 0 ? lines.join("\n") : `No messages matched “${query}”. Try fewer or different keywords.`;
}

/**
 * Before the model starts: looks for earlier discussion in other chats that a
 * question about the past may depend on. Tries the two strongest terms
 * together, then the strongest alone.
 */
export async function recallRelated(context: SearchScope, terms: string[]): Promise<string[]> {
  const queries = [...new Set([terms.slice(0, 2).join(" "), terms[0] ?? ""])].filter((query) => query.length >= 3);
  for (const query of queries) {
    const lines = await searchLines(context, query, { limit: 5, otherChatsOnly: true });
    if (lines.length > 0) return lines;
  }
  return [];
}

function listMembers(context: ToolContext): string {
  const people = [...context.directory.people.values()].sort((a, b) => a.name.localeCompare(b.name));
  if (people.length === 0) return "No members found.";
  return people
    .map((person) => {
      const details = [person.title, person.role !== "member" ? person.role : null, person.status].filter(Boolean).join(" · ");
      return `- ${person.name}${details ? ` (${details})` : ""}`;
    })
    .join("\n");
}

async function webSearch(call: ToolCall, context: ToolContext): Promise<string> {
  const query = words(call.input.query, 300);
  if (query.length < 2) throw new ToolInputError("Give a search query of at least two characters.");
  if (!(await context.billing.hold(WEB_SEARCH_HOLD))) {
    throw new ToolInputError("The person you're replying to is out of AI credits, so the web can't be searched. Answer without it and say so.");
  }
  let credits = 0;
  try {
    const findings = await searchWeb(query, context.signal);
    credits = findings.credits;
    return formatFindings(query, findings);
  } finally {
    await context.billing.settle(credits);
  }
}

async function readPage(call: ToolCall, context: ToolContext): Promise<string> {
  const url = typeof call.input.url === "string" ? call.input.url : "";
  if (!url.trim()) throw new ToolInputError("Give the full address of the page to read.");
  return formatPage(await readWebPage(url, context.signal));
}

async function run(call: ToolCall, context: ToolContext): Promise<string> {
  switch (call.name) {
    case HISTORY.name:
      return readEarlierMessages(call, context);
    case SEARCH.name:
      return searchWorkspace(call, context);
    case DIRECTORY.name:
      return listMembers(context);
    case SEARCH_WEB.name:
      return webSearch(call, context);
    case READ_WEB_PAGE.name:
      return readPage(call, context);
  }
  if (TASK_TOOL_NAMES.has(call.name)) return executeTaskTool(call, context);
  if (GITHUB_TOOL_NAMES.has(call.name)) {
    if (!context.github) {
      throw new ToolInputError("GitHub isn't connected to this workspace. A workspace admin can connect it in Settings → Connected apps.");
    }
    return executeGithubTool(call, context.github, {
      requester: context.directory.personName(context.userId),
      agentName: context.agentName,
      signal: context.signal,
    });
  }
  throw new ToolInputError(`There is no tool named ${call.name}.`);
}

export async function executeTool(call: ToolCall, context: ToolContext): Promise<ToolResult> {
  const result = (output: string, isError = false): ToolResult => ({
    callId: call.id,
    name: call.name,
    output: cap(output, OUTPUT_CHARS[call.name] ?? DEFAULT_OUTPUT_CHARS),
    isError,
  });
  if ("__invalid_arguments" in call.input) return result("The tool arguments weren't valid JSON. Try again.", true);

  try {
    return result(await run(call, context));
  } catch (error) {
    if (context.signal.aborted) throw error;
    if (error instanceof ToolInputError || error instanceof WebToolError) return result(error.message, true);
    log.warn("tool failed", { tool: call.name, error });
    return result("The tool failed. Answer with what you already know, and say what you couldn't check.", true);
  }
}
