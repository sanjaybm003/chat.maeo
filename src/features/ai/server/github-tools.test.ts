import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const github = vi.hoisted(() => ({
  requests: [] as Array<{ path: string; method: string; body?: unknown }>,
  answer: (() => undefined) as (path: string, method: string) => unknown,
}));

vi.mock("@/features/integrations/server/github", () => {
  class GithubError extends Error {
    constructor(
      readonly status: number,
      message: string,
    ) {
      super(message);
    }
  }
  return {
    githubApp: { configured: true },
    GithubError,
    githubRequest: async (_installation: string, path: string, options: { method?: string; body?: unknown } = {}) => {
      const method = options.method ?? "GET";
      github.requests.push({ path, method, body: options.body });
      return github.answer(path, method);
    },
    listInstallationRepositories: async () => [],
  };
});

const { executeGithubTool, readFileChanges } = await import("./github-tools");
const { GithubError } = await import("@/features/integrations/server/github");

const access = { installationId: "42", defaultRepo: "acme/web" };
const extra = { requester: "Priya Sharma", agentName: "Dev", signal: new AbortController().signal };
const call = (name: string, input: Record<string, unknown>) => ({ id: "call-1", name, input });

beforeEach(() => {
  github.requests.length = 0;
});

describe("opening pull requests", () => {
  it("commits to a new branch and opens a pull request, never touching the base branch", async () => {
    github.answer = (path, method) => {
      if (path === "/repos/acme/web") return { default_branch: "main" };
      if (path === "/repos/acme/web/git/ref/heads/main") return { object: { sha: "base-sha" } };
      if (path === "/repos/acme/web/git/commits/base-sha") return { tree: { sha: "base-tree" } };
      if (path === "/repos/acme/web/git/trees" && method === "POST") return { sha: "new-tree" };
      if (path === "/repos/acme/web/git/commits" && method === "POST") return { sha: "new-commit" };
      if (path === "/repos/acme/web/git/refs" && method === "POST") return {};
      if (path.startsWith("/repos/acme/web/pulls?state=open")) return [];
      if (path === "/repos/acme/web/pulls" && method === "POST") return { number: 7, html_url: "https://github.com/acme/web/pull/7" };
      throw new Error(`unexpected ${method} ${path}`);
    };

    const output = await executeGithubTool(
      call("github_open_pull_request", {
        title: "Fix login redirect",
        body: "Sends people back to the page they started on.",
        files: [
          { path: "src/login.ts", content: "export const next = '/';\n" },
          { path: "old.txt", delete: true },
        ],
      }),
      access,
      extra,
    );

    expect(output).toContain("Opened pull request #7 in acme/web");
    expect(output).toContain("https://github.com/acme/web/pull/7");
    expect(github.requests.find((request) => request.path === "/repos/acme/web/git/trees")?.body).toEqual({
      base_tree: "base-tree",
      tree: [
        { path: "src/login.ts", mode: "100644", type: "blob", content: "export const next = '/';\n" },
        { path: "old.txt", mode: "100644", type: "blob", sha: null },
      ],
    });
    const ref = github.requests.find((request) => request.path === "/repos/acme/web/git/refs")?.body as { ref: string; sha: string };
    expect(ref.ref).toMatch(/^refs\/heads\/maeosan\/fix-login-redirect-[0-9a-f]{6}$/);
    expect(ref.sha).toBe("new-commit");
    const pull = github.requests.find((request) => request.path === "/repos/acme/web/pulls")?.body as { base: string; body: string };
    expect(pull.base).toBe("main");
    expect(pull.body).toContain("Opened by Dev in maeosan for Priya Sharma.");
    expect(github.requests.some((request) => request.method === "PATCH")).toBe(false);
  });

  it("adds a commit to its own earlier branch and points at the pull request already open", async () => {
    github.answer = (path, method) => {
      if (path === "/repos/acme/web") return { default_branch: "main" };
      if (path === "/repos/acme/web/git/ref/heads/main") return { object: { sha: "base-sha" } };
      if (path === "/repos/acme/web/git/ref/heads/maeosan/fix-login") return { object: { sha: "branch-sha" } };
      if (path === "/repos/acme/web/git/commits/branch-sha") return { tree: { sha: "branch-tree" } };
      if (path === "/repos/acme/web/git/trees") return { sha: "tree-2" };
      if (path === "/repos/acme/web/git/commits") return { sha: "commit-2" };
      if (path === "/repos/acme/web/git/refs/heads/maeosan/fix-login" && method === "PATCH") return {};
      if (path.startsWith("/repos/acme/web/pulls?state=open")) return [{ number: 7, title: "Fix login redirect", html_url: "https://github.com/acme/web/pull/7" }];
      throw new Error(`unexpected ${method} ${path}`);
    };

    const output = await executeGithubTool(
      call("github_open_pull_request", { title: "Address review", body: "Handles the empty state.", branch: "maeosan/fix-login", files: [{ path: "src/login.ts", content: "x" }] }),
      access,
      extra,
    );

    expect(output).toContain("updating pull request #7");
    expect(github.requests.find((request) => request.method === "PATCH")?.body).toEqual({ sha: "commit-2", force: false });
    expect(github.requests.find((request) => request.path === "/repos/acme/web/git/commits")?.body).toMatchObject({ parents: ["branch-sha"] });
  });

  it("refuses unsafe paths, the base branch as target, and a missing repository", async () => {
    expect(() => readFileChanges([{ path: "../secrets.env", content: "x" }])).toThrow(/valid path/);
    expect(() => readFileChanges([{ path: "a.ts" }])).toThrow(/complete new content/);
    expect(() => readFileChanges([])).toThrow(/List the files/);

    github.answer = () => ({ default_branch: "main" });
    await expect(
      executeGithubTool(call("github_open_pull_request", { title: "x", body: "y", branch: "main", files: [{ path: "a.ts", content: "1" }] }), access, extra),
    ).rejects.toThrow(/separate branch/);
    await expect(executeGithubTool(call("github_read_file", { path: "README.md" }), { installationId: "42", defaultRepo: null }, extra)).rejects.toThrow(
      /Say which repository/,
    );
  });
});

describe("reading code", () => {
  it("numbers lines and says where to continue", async () => {
    github.answer = (path) => {
      if (path === "/repos/acme/web/contents/src/app.ts") return { type: "file", encoding: "base64", content: Buffer.from("one\ntwo\nthree\nfour").toString("base64") };
      throw new Error(`unexpected ${path}`);
    };
    const output = await executeGithubTool(call("github_read_file", { path: "src/app.ts", start_line: 2, end_line: 3 }), access, extra);
    expect(output).toContain("acme/web/src/app.ts · 4 lines");
    expect(output).toContain("2| two\n3| three");
    expect(output).toContain("Continue with start_line 4");
  });

  it("explains GitHub's refusals in words the agent can pass on", async () => {
    github.answer = () => {
      throw new GithubError(404, "Not Found");
    };
    await expect(executeGithubTool(call("github_list_files", { repo: "acme/private" }), access, extra)).rejects.toThrow(/found nothing while listing files/);
  });
});
