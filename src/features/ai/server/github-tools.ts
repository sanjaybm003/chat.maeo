import "server-only";

import { randomBytes } from "node:crypto";

import { githubApp, GithubError, githubRequest, listInstallationRepositories } from "@/features/integrations/server/github";
import type { AgentRunStep } from "@/types/domain";

import type { AdminClient } from "./directory";
import type { ToolCall, ToolSpec } from "./providers/types";
import { ToolInputError } from "./tool-errors";

/**
 * Agents work in the workspace's GitHub through the connected app: they read
 * code, and they propose changes only as pull requests on their own branches,
 * so a person always reviews before anything is merged.
 */

export interface GithubAccess {
  installationId: string;
  defaultRepo: string | null;
}

const REPO_PATTERN = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/;
const BRANCH_PATTERN = /^(?!.*\.\.)(?!\/)(?!.*\/$)[A-Za-z0-9._/-]{1,120}$/;
const MAX_FILES_PER_PULL = 40;
const MAX_FILE_CHARS = 300_000;
const MAX_TOTAL_CHARS = 1_000_000;
const READ_LINES = 400;
const READ_LINES_MAX = 700;
const LIST_LIMIT = 400;
const REQUEST_TIMEOUT_MS = 25_000;

const repoProperty = { type: "string", description: "The repository as owner/name. Leave it out to use the workspace's default repository." };

export const GITHUB_TOOL_SPECS: ToolSpec[] = [
  {
    name: "github_list_repositories",
    description: "List the GitHub repositories connected to this workspace, most recently active first, with default branch and language.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "github_list_files",
    description: "List the files in a repository, or under one folder. Use it to find where things live before reading.",
    parameters: {
      type: "object",
      properties: {
        repo: repoProperty,
        path: { type: "string", description: "A folder, like src/components. Leave it out for the whole repository." },
        ref: { type: "string", description: "A branch, tag or commit. Leave it out for the default branch." },
      },
    },
  },
  {
    name: "github_read_file",
    description: "Read a file with line numbers. Long files come in parts: ask for the lines you need with start_line and end_line.",
    parameters: {
      type: "object",
      properties: {
        repo: repoProperty,
        path: { type: "string", description: "The file path, like src/app/page.tsx." },
        ref: { type: "string", description: "A branch, tag or commit. Leave it out for the default branch." },
        start_line: { type: "integer", minimum: 1 },
        end_line: { type: "integer", minimum: 1 },
      },
      required: ["path"],
    },
  },
  {
    name: "github_search_code",
    description: "Search a repository's code on its default branch for a name, a string or an error message. Returns matching files with a snippet.",
    parameters: {
      type: "object",
      properties: {
        repo: repoProperty,
        query: { type: "string", description: "What to find, like a function name or an exact error message." },
      },
      required: ["query"],
    },
  },
  {
    name: "github_open_pull_request",
    description:
      "Commit changes to a branch and open a pull request for the team to review. It never commits to the branch being merged into. Read every file before you change it, and give the complete new contents of each changed file. To revise a pull request you opened earlier, pass its branch.",
    parameters: {
      type: "object",
      properties: {
        repo: repoProperty,
        title: { type: "string", description: "The pull request title, under 80 characters." },
        body: { type: "string", description: "What changed and why, how to test it, and what reviewers should look at." },
        files: {
          type: "array",
          description: "Every file to create, change or delete.",
          items: {
            type: "object",
            properties: {
              path: { type: "string" },
              content: { type: "string", description: "The complete new file contents." },
              delete: { type: "boolean", description: "True to delete the file instead." },
            },
            required: ["path"],
          },
        },
        branch: { type: "string", description: "The branch to commit to. Leave it out to start a new one." },
        base: { type: "string", description: "The branch to merge into. Leave it out for the default branch." },
        commit_message: { type: "string" },
      },
      required: ["title", "body", "files"],
    },
  },
];

export const GITHUB_TOOL_NAMES: ReadonlySet<string> = new Set(GITHUB_TOOL_SPECS.map((spec) => spec.name));

const text = (value: unknown, max: number) => (typeof value === "string" ? value.trim().slice(0, max) : "");
const encodeRef = (ref: string) => ref.split("/").map(encodeURIComponent).join("/");
const formatSize = (bytes: number) => (bytes < 1024 ? `${bytes} B` : `${Math.round(bytes / 1024)} KB`);

function clampLine(value: unknown, min: number, max: number, fallback: number) {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
}

export async function loadGithubAccess(admin: AdminClient, workspaceId: string): Promise<GithubAccess | null> {
  if (!githubApp.configured) return null;
  const { data, error } = await admin
    .from("workspace_integrations")
    .select("external_id, settings")
    .eq("workspace_id", workspaceId)
    .eq("provider", "github")
    .maybeSingle();
  if (error || !data) return null;
  const settings = data.settings && typeof data.settings === "object" && !Array.isArray(data.settings) ? data.settings : {};
  const defaultRepo = "default_repo" in settings && typeof settings.default_repo === "string" ? settings.default_repo : null;
  return { installationId: data.external_id, defaultRepo };
}

export function describeGithubToolCall(call: ToolCall): AgentRunStep | null {
  const repo = text(call.input.repo, 80);
  switch (call.name) {
    case "github_list_repositories":
      return { kind: "tool", label: "Looking at the GitHub repositories" };
    case "github_list_files":
      return { kind: "tool", label: `Browsing ${text(call.input.path, 70) || repo || "the repository"}` };
    case "github_read_file":
      return { kind: "tool", label: `Reading ${text(call.input.path, 90) || "a file"}` };
    case "github_search_code":
      return { kind: "tool", label: `Searching the code for “${text(call.input.query, 50)}”` };
    case "github_open_pull_request":
      return { kind: "tool", label: `Opening a pull request${repo ? ` in ${repo}` : ""}` };
    default:
      return null;
  }
}

function repoFrom(input: Record<string, unknown>, access: GithubAccess) {
  const repo = text(input.repo, 201) || access.defaultRepo || "";
  if (!repo) {
    throw new ToolInputError("Say which repository, as owner/name. github_list_repositories shows them; this workspace has no default repository.");
  }
  if (!REPO_PATTERN.test(repo)) throw new ToolInputError(`"${repo}" isn't a repository name. Use owner/name, like acme/website.`);
  return repo;
}

function cleanPath(value: unknown, required: boolean) {
  const path = text(value, 500).replace(/^\.?\/+/, "").replace(/\/+$/, "");
  if (!path) {
    if (required) throw new ToolInputError("Give a file path, like src/app/page.tsx.");
    return "";
  }
  if (path.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new ToolInputError(`"${path}" isn't a valid path inside the repository.`);
  }
  return path;
}

interface CallOptions {
  method?: "GET" | "POST" | "PATCH";
  body?: unknown;
  accept?: string;
}

function gh<T>(access: GithubAccess, path: string, signal: AbortSignal, options: CallOptions = {}) {
  return githubRequest<T>(access.installationId, path, { ...options, signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) });
}

async function defaultBranch(access: GithubAccess, repo: string, signal: AbortSignal) {
  return (await gh<{ default_branch: string }>(access, `/repos/${repo}`, signal)).default_branch;
}

async function listRepositories(access: GithubAccess) {
  const repos = await listInstallationRepositories(access.installationId, 80);
  if (repos.length === 0) {
    return "The GitHub app can't see any repositories yet. A workspace admin can choose repositories in the app's settings on GitHub.";
  }
  return [
    access.defaultRepo ? `Default repository: ${access.defaultRepo}` : "No default repository is set.",
    ...repos.map(
      (repo) =>
        `- ${repo.fullName}${repo.private ? " (private)" : ""} · default branch ${repo.defaultBranch}${repo.language ? ` · ${repo.language}` : ""}${repo.description ? ` · ${repo.description.slice(0, 120)}` : ""}`,
    ),
  ].join("\n");
}

async function listFiles(access: GithubAccess, input: Record<string, unknown>, signal: AbortSignal) {
  const repo = repoFrom(input, access);
  const folder = cleanPath(input.path, false);
  const ref = text(input.ref, 120) || (await defaultBranch(access, repo, signal));
  const data = await gh<{ tree: Array<{ path: string; type: string; size?: number }>; truncated: boolean }>(
    access,
    `/repos/${repo}/git/trees/${encodeRef(ref)}?recursive=1`,
    signal,
  );
  const prefix = folder ? `${folder}/` : "";
  const files = data.tree.filter((entry) => entry.type === "blob" && entry.path.startsWith(prefix));
  if (files.length === 0) return folder ? `Nothing under ${folder}/ on ${ref}.` : `${repo} has no files on ${ref}.`;

  const shown = files.slice(0, LIST_LIMIT).map((entry) => `${entry.path}${entry.size !== undefined ? ` (${formatSize(entry.size)})` : ""}`);
  const more =
    files.length > LIST_LIMIT
      ? `\n…and ${files.length - LIST_LIMIT} more. List a narrower folder.`
      : data.truncated
        ? "\n(GitHub cut the listing short. List a narrower folder.)"
        : "";
  return `${repo} @ ${ref}${folder ? ` under ${folder}/` : ""}: ${files.length} files\n${shown.join("\n")}${more}`;
}

async function readFile(access: GithubAccess, input: Record<string, unknown>, signal: AbortSignal) {
  const repo = repoFrom(input, access);
  const path = cleanPath(input.path, true);
  const ref = text(input.ref, 120);
  const data = await gh<unknown>(access, `/repos/${repo}/contents/${encodeRef(path)}${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`, signal);

  if (Array.isArray(data)) {
    const entries = data.flatMap((item) =>
      item && typeof item === "object" && "name" in item && typeof item.name === "string"
        ? [`- ${item.name}${"type" in item && item.type === "dir" ? "/" : ""}`]
        : [],
    );
    return `${path} is a folder:\n${entries.join("\n")}`;
  }

  const file = (data ?? {}) as { type?: string; encoding?: string; content?: string; sha?: string; size?: number };
  if (file.type !== "file") throw new ToolInputError(`${path} isn't a regular file.`);
  let base64 = file.encoding === "base64" ? (file.content ?? "") : "";
  if (!base64 && file.sha) {
    if ((file.size ?? 0) > 3_000_000) throw new ToolInputError(`${path} is too large to read (${formatSize(file.size ?? 0)}).`);
    base64 = (await gh<{ content: string }>(access, `/repos/${repo}/git/blobs/${file.sha}`, signal)).content;
  }
  const content = Buffer.from(base64.replace(/\s/g, ""), "base64").toString("utf8");
  if (content.includes("\u0000")) throw new ToolInputError(`${path} is a binary file.`);

  const lines = content.split("\n");
  const start = clampLine(input.start_line, 1, Math.max(lines.length, 1), 1);
  const last = Math.min(lines.length, start + READ_LINES_MAX - 1);
  const end = clampLine(input.end_line, start, last, Math.min(lines.length, start + READ_LINES - 1));
  const width = String(end).length;
  const body = lines
    .slice(start - 1, end)
    .map((line, index) => `${String(start + index).padStart(width, " ")}| ${line}`)
    .join("\n");
  const more = end < lines.length ? `\n(Lines ${start}-${end} of ${lines.length}. Continue with start_line ${end + 1}.)` : "";
  return `${repo}/${path}${ref ? ` @ ${ref}` : ""} · ${lines.length} lines\n${body}${more}`;
}

async function searchCode(access: GithubAccess, input: Record<string, unknown>, signal: AbortSignal) {
  const repo = repoFrom(input, access);
  const query = text(input.query, 200).replace(/\s+/g, " ");
  if (query.length < 2) throw new ToolInputError("Give something to search for.");
  const data = await gh<{ total_count: number; items: Array<{ path: string; text_matches?: Array<{ fragment?: string }> }> }>(
    access,
    `/search/code?q=${encodeURIComponent(`${query.replace(/["\\]/g, " ")} repo:${repo}`)}&per_page=15`,
    signal,
    { accept: "application/vnd.github.text-match+json" },
  );
  if (data.items.length === 0) {
    return `No code in ${repo} matched "${query}". Code search only covers the default branch; try other words, or browse with github_list_files.`;
  }
  return [
    `${data.total_count} matches in ${repo} for "${query}":`,
    ...data.items.map((item) => {
      const fragment = item.text_matches?.[0]?.fragment?.replace(/\s+/g, " ").trim().slice(0, 240);
      return `- ${item.path}${fragment ? `: ${fragment}` : ""}`;
    }),
  ].join("\n");
}

interface FileChange {
  path: string;
  /** Null deletes the file. */
  content: string | null;
}

export function readFileChanges(value: unknown): FileChange[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ToolInputError("List the files to change in files, each with its path and complete new content.");
  }
  if (value.length > MAX_FILES_PER_PULL) throw new ToolInputError(`Change at most ${MAX_FILES_PER_PULL} files in one pull request.`);
  let total = 0;
  const seen = new Set<string>();
  return value.map((item) => {
    if (!item || typeof item !== "object") throw new ToolInputError("Each file needs a path and its content.");
    const entry = item as Record<string, unknown>;
    const path = cleanPath(entry.path, true);
    if (seen.has(path)) throw new ToolInputError(`${path} is listed twice.`);
    seen.add(path);
    if (entry.delete === true) return { path, content: null };
    if (typeof entry.content !== "string") throw new ToolInputError(`Give the complete new content of ${path}, or delete: true to remove it.`);
    if (entry.content.length > MAX_FILE_CHARS) throw new ToolInputError(`${path} is too large to commit from chat.`);
    total += entry.content.length;
    if (total > MAX_TOTAL_CHARS) throw new ToolInputError("These changes are too large for one pull request. Split them up.");
    return { path, content: entry.content };
  });
}

const branchSlug = (title: string) =>
  title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "change";

async function openPullRequest(access: GithubAccess, input: Record<string, unknown>, extra: GithubToolExtra) {
  const { signal } = extra;
  const repo = repoFrom(input, access);
  const title = text(input.title, 120);
  if (!title) throw new ToolInputError("Give the pull request a title.");
  const files = readFileChanges(input.files);
  const base = text(input.base, 120) || (await defaultBranch(access, repo, signal));
  const requested = text(input.branch, 120);
  if (requested && !BRANCH_PATTERN.test(requested)) throw new ToolInputError(`"${requested}" isn't a usable branch name.`);
  if (requested && requested === base) throw new ToolInputError("Commit to a separate branch, not the branch the pull request merges into.");
  const branch = requested || `maeosan/${branchSlug(title)}-${randomBytes(3).toString("hex")}`;

  let parentSha = (await gh<{ object: { sha: string } }>(access, `/repos/${repo}/git/ref/heads/${encodeRef(base)}`, signal)).object.sha;
  let branchExists = false;
  if (requested) {
    try {
      parentSha = (await gh<{ object: { sha: string } }>(access, `/repos/${repo}/git/ref/heads/${encodeRef(branch)}`, signal)).object.sha;
      branchExists = true;
    } catch (error) {
      if (!(error instanceof GithubError && error.status === 404)) throw error;
    }
  }

  const parent = await gh<{ tree: { sha: string } }>(access, `/repos/${repo}/git/commits/${parentSha}`, signal);
  const tree = await gh<{ sha: string }>(access, `/repos/${repo}/git/trees`, signal, {
    method: "POST",
    body: {
      base_tree: parent.tree.sha,
      tree: files.map((file) =>
        file.content === null
          ? { path: file.path, mode: "100644", type: "blob", sha: null }
          : { path: file.path, mode: "100644", type: "blob", content: file.content },
      ),
    },
  });
  const commit = await gh<{ sha: string }>(access, `/repos/${repo}/git/commits`, signal, {
    method: "POST",
    body: { message: text(input.commit_message, 500) || title, tree: tree.sha, parents: [parentSha] },
  });
  if (branchExists) {
    await gh(access, `/repos/${repo}/git/refs/heads/${encodeRef(branch)}`, signal, { method: "PATCH", body: { sha: commit.sha, force: false } });
  } else {
    await gh(access, `/repos/${repo}/git/refs`, signal, { method: "POST", body: { ref: `refs/heads/${branch}`, sha: commit.sha } });
  }

  const changed = `${files.length} ${files.length === 1 ? "file" : "files"}: ${files
    .slice(0, 12)
    .map((file) => (file.content === null ? `${file.path} (deleted)` : file.path))
    .join(", ")}${files.length > 12 ? ", …" : ""}`;

  const owner = repo.split("/")[0];
  const existing = await gh<Array<{ number: number; html_url: string; title: string }>>(
    access,
    `/repos/${repo}/pulls?state=open&head=${encodeURIComponent(`${owner}:${branch}`)}`,
    signal,
  );
  if (existing[0]) {
    return `Pushed a new commit to ${branch}, updating pull request #${existing[0].number}: ${existing[0].title}\n${existing[0].html_url}\nChanged ${changed}.`;
  }

  const body = `${text(input.body, 20_000)}\n\n---\nOpened by ${extra.agentName} in maeosan for ${extra.requester}.`.trim();
  const pull = await gh<{ number: number; html_url: string }>(access, `/repos/${repo}/pulls`, signal, {
    method: "POST",
    body: { title, head: branch, base, body, maintainer_can_modify: true },
  });
  return `Opened pull request #${pull.number} in ${repo}: ${title}\n${pull.html_url}\nBranch ${branch} into ${base}. Changed ${changed}. Nothing is merged until someone reviews it.`;
}

export interface GithubToolExtra {
  requester: string;
  agentName: string;
  signal: AbortSignal;
}

const DOING: Record<string, string> = {
  github_list_repositories: "listing repositories",
  github_list_files: "listing files",
  github_read_file: "reading the file",
  github_search_code: "searching the code",
  github_open_pull_request: "opening the pull request",
};

function explain(error: unknown, doing: string): never {
  if (error instanceof GithubError) {
    if (error.status === 401) throw new ToolInputError("The GitHub connection needs renewing. Ask a workspace admin to reconnect GitHub in Settings.");
    if (error.status === 403) {
      throw new ToolInputError(`GitHub refused while ${doing}: ${error.message}. A workspace admin may need to give the app access to this repository.`);
    }
    if (error.status === 404) {
      throw new ToolInputError(`GitHub found nothing while ${doing}. Check the repository, path and branch, and that the app can reach this repository.`);
    }
    if (error.status === 409 || error.status === 422) throw new ToolInputError(`GitHub couldn't finish ${doing}: ${error.message}`);
  }
  throw error;
}

export async function executeGithubTool(call: ToolCall, access: GithubAccess, extra: GithubToolExtra): Promise<string> {
  try {
    switch (call.name) {
      case "github_list_repositories":
        return await listRepositories(access);
      case "github_list_files":
        return await listFiles(access, call.input, extra.signal);
      case "github_read_file":
        return await readFile(access, call.input, extra.signal);
      case "github_search_code":
        return await searchCode(access, call.input, extra.signal);
      case "github_open_pull_request":
        return await openPullRequest(access, call.input, extra);
      default:
        throw new ToolInputError(`There is no tool named ${call.name}.`);
    }
  } catch (error) {
    if (error instanceof ToolInputError) throw error;
    explain(error, DOING[call.name] ?? "working in GitHub");
  }
}
