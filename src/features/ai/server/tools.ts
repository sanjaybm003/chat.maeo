import "server-only";

import type { AgentRunStep } from "@/types/domain";

import type { AgentToolId } from "../agent-spec";
import type { AdminClient, NameDirectory } from "./directory";
import type { ToolCall, ToolResult, ToolSpec } from "./providers/types";
import { formatTranscript, TRANSCRIPT_COLUMNS, type TranscriptMessage } from "./transcript";

const MAX_TOOL_OUTPUT_CHARS = 8000;

type FunctionToolId = Exclude<AgentToolId, "web">;

export const TOOL_SPECS: Record<FunctionToolId, ToolSpec> = {
  history: {
    name: "read_earlier_messages",
    description:
      "Read messages from this conversation that are older than the ones you were given. Use it when the answer depends on something said earlier.",
    parameters: {
      type: "object",
      properties: {
        limit: { type: "integer", description: "How many older messages to read, from 1 to 50.", minimum: 1, maximum: 50 },
      },
      required: [],
    },
  },
  search: {
    name: "search_workspace_messages",
    description:
      "Search messages across the workspace. Only messages that everyone in this conversation can already see are returned. Gives the best matches with who said them, where and when.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "The words to look for." } },
      required: ["query"],
    },
  },
  directory: {
    name: "list_workspace_members",
    description: "List everyone in this workspace with their name, job title, role and status.",
    parameters: { type: "object", properties: {}, required: [] },
  },
};

const NAME_TO_TOOL = new Map(Object.entries(TOOL_SPECS).map(([id, spec]) => [spec.name, id as FunctionToolId]));

export interface ToolContext {
  admin: AdminClient;
  directory: NameDirectory;
  workspaceId: string;
  conversationId: string;
  userId: string;
  /** Moves back each time read_earlier_messages pages further. */
  oldestLoadedAt: string | null;
}

const clamp = (value: unknown, min: number, max: number, fallback: number) => {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
};

const cap = (text: string) => (text.length > MAX_TOOL_OUTPUT_CHARS ? `${text.slice(0, MAX_TOOL_OUTPUT_CHARS)}\n…(truncated)` : text);

/** What the people in the chat see while the agent works. */
export function describeToolCall(call: ToolCall): AgentRunStep {
  switch (NAME_TO_TOOL.get(call.name)) {
    case "history":
      return { kind: "tool", label: "Reading earlier messages" };
    case "search": {
      const query = typeof call.input.query === "string" ? call.input.query.trim().slice(0, 60) : "";
      return { kind: "tool", label: query ? `Searching for “${query}”` : "Searching the workspace" };
    }
    case "directory":
      return { kind: "tool", label: "Looking up the team" };
    default:
      return { kind: "tool", label: "Working" };
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

async function searchWorkspace(call: ToolCall, context: ToolContext): Promise<string> {
  const query = typeof call.input.query === "string" ? call.input.query.trim().slice(0, 200) : "";
  if (query.length < 2) return "Give a search query of at least two characters.";

  // The reply is read by everyone in this conversation, so results are limited to what they can all see.
  const { data, error } = await context.admin.rpc("ai_search_messages_for", {
    p_user_id: context.userId,
    p_workspace_id: context.workspaceId,
    p_audience_conversation_id: context.conversationId,
    p_query: query,
    p_limit: 10,
  });
  if (error) throw error;
  const hits = data ?? [];
  if (hits.length === 0) return `No messages matched “${query}”.`;

  const conversationIds = [...new Set(hits.map((hit) => hit.conversation_id))];
  const { data: conversations } = await context.admin
    .from("conversations")
    .select("id, name, kind, agent_id")
    .in("id", conversationIds);
  const titles = new Map(
    (conversations ?? []).map((conversation) => [
      conversation.id,
      conversation.name ? `“${conversation.name}”` : conversation.agent_id ? "an agent chat" : conversation.kind === "direct" ? "a direct chat" : "a group chat",
    ]),
  );

  return hits
    .map((hit) => {
      const snippet = hit.body.replace(/\s+/g, " ").slice(0, 300);
      return `- ${hit.created_at.slice(0, 10)} · ${context.directory.authorName(hit)} in ${titles.get(hit.conversation_id) ?? "a chat"}: ${snippet}`;
    })
    .join("\n");
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

export async function executeTool(call: ToolCall, context: ToolContext): Promise<ToolResult> {
  const tool = NAME_TO_TOOL.get(call.name);
  const result = (output: string, isError = false): ToolResult => ({ callId: call.id, name: call.name, output: cap(output), isError });

  if (!tool) return result(`There is no tool named ${call.name}.`, true);
  if ("__invalid_arguments" in call.input) return result("The tool arguments weren't valid JSON. Try again.", true);

  try {
    switch (tool) {
      case "history":
        return result(await readEarlierMessages(call, context));
      case "search":
        return result(await searchWorkspace(call, context));
      case "directory":
        return result(listMembers(context));
    }
  } catch {
    return result("The tool failed. Answer with what you already know.", true);
  }
}
