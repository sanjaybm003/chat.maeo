import "server-only";

import { createHmac, createPrivateKey, randomBytes, sign, timingSafeEqual } from "node:crypto";

/**
 * maeosan's GitHub App. A workspace admin installs it on their account or
 * organization; agents then act through short-lived installation tokens minted
 * from the app's private key. No GitHub token is ever stored.
 */

const read = (name: string) => process.env[name]?.trim() || null;

export const GITHUB_API = "https://api.github.com";
export const INSTALL_STATE_COOKIE = "maeosan_github_install";
const STATE_TTL_MS = 10 * 60 * 1000;

export const githubApp = {
  get appId() {
    return read("GITHUB_APP_ID");
  },
  get slug() {
    return read("GITHUB_APP_SLUG");
  },
  get clientId() {
    return read("GITHUB_APP_CLIENT_ID");
  },
  get clientSecret() {
    return read("GITHUB_APP_CLIENT_SECRET");
  },
  /** PEM. Single-line environment variables carry the line breaks as "\n". */
  get privateKey() {
    return read("GITHUB_APP_PRIVATE_KEY")?.replace(/\\n/g, "\n") ?? null;
  },
  get configured() {
    return Boolean(read("GITHUB_APP_ID") && read("GITHUB_APP_SLUG") && read("GITHUB_APP_CLIENT_ID") && read("GITHUB_APP_CLIENT_SECRET") && read("GITHUB_APP_PRIVATE_KEY"));
  },
};

export class GithubError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "GithubError";
  }
}

const base64url = (input: Buffer | string) => Buffer.from(input).toString("base64url");

/** A JWT that authenticates as the app itself, valid for nine minutes. */
export function createAppJwt(appId: string, privateKeyPem: string, now = Date.now()) {
  // Issued a minute in the past so a slightly fast clock on GitHub's side still accepts it.
  const issuedAt = Math.floor(now / 1000) - 60;
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = base64url(JSON.stringify({ iat: issuedAt, exp: issuedAt + 540, iss: appId }));
  const signature = sign("sha256", Buffer.from(`${header}.${payload}`), createPrivateKey(privateKeyPem));
  return `${header}.${payload}.${base64url(signature)}`;
}

/** Ties an installation round trip to the admin who started it and the workspace it's for. */
export function createInstallState(secret: string, input: { workspaceId: string; userId: string }, now = Date.now()) {
  const payload = base64url(
    JSON.stringify({ w: input.workspaceId, u: input.userId, e: now + STATE_TTL_MS, n: randomBytes(12).toString("base64url") }),
  );
  return `${payload}.${createHmac("sha256", secret).update(payload).digest("base64url")}`;
}

export function readInstallState(secret: string, token: string, now = Date.now()): { workspaceId: string; userId: string } | null {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [payload, mac] = parts;
  const expected = createHmac("sha256", secret).update(payload).digest();
  const given = Buffer.from(mac, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    if (typeof data.w !== "string" || typeof data.u !== "string" || typeof data.e !== "number" || data.e < now) return null;
    return { workspaceId: data.w, userId: data.u };
  } catch {
    return null;
  }
}

interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  accept?: string;
  signal?: AbortSignal;
}

async function request<T>(path: string, token: string, options: RequestOptions = {}): Promise<T> {
  const response = await fetch(path.startsWith("https://") ? path : `${GITHUB_API}${path}`, {
    method: options.method ?? "GET",
    headers: {
      Accept: options.accept ?? "application/vnd.github+json",
      Authorization: `Bearer ${token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "maeosan",
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    signal: options.signal ?? AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  if (response.status === 204) return undefined as T;
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "message" in data && typeof data.message === "string"
        ? data.message
        : `GitHub answered ${response.status}.`;
    throw new GithubError(response.status, message);
  }
  return data as T;
}

const installationTokens = new Map<string, { token: string; expiresAt: number }>();

async function installationToken(installationId: string) {
  const cached = installationTokens.get(installationId);
  if (cached && cached.expiresAt - Date.now() > 5 * 60_000) return cached.token;

  const { appId, privateKey } = githubApp;
  if (!appId || !privateKey) throw new GithubError(503, "GitHub isn't set up on this server.");
  const data = await request<{ token: string; expires_at: string }>(
    `/app/installations/${encodeURIComponent(installationId)}/access_tokens`,
    createAppJwt(appId, privateKey),
    { method: "POST" },
  );
  installationTokens.set(installationId, { token: data.token, expiresAt: Date.parse(data.expires_at) || Date.now() + 50 * 60_000 });
  return data.token;
}

/** Calls the GitHub API as the app's installation for one workspace. */
export async function githubRequest<T>(installationId: string, path: string, options?: RequestOptions): Promise<T> {
  try {
    return await request<T>(path, await installationToken(installationId), options);
  } catch (error) {
    if (error instanceof GithubError && error.status === 401) installationTokens.delete(installationId);
    throw error;
  }
}

/** What the app is installed on, asked as the app. */
export async function describeInstallation(installationId: string) {
  const { appId, privateKey } = githubApp;
  if (!appId || !privateKey) throw new GithubError(503, "GitHub isn't set up on this server.");
  const data = await request<{ account: { login?: string; type?: string } | null }>(
    `/app/installations/${encodeURIComponent(installationId)}`,
    createAppJwt(appId, privateKey),
  );
  return { login: data.account?.login ?? "", type: data.account?.type ?? "" };
}

/** Exchanges the sign-in code GitHub sends back after installation for a token of the person who installed. */
export async function exchangeOAuthCode(code: string) {
  const response = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "User-Agent": "maeosan" },
    body: JSON.stringify({ client_id: githubApp.clientId, client_secret: githubApp.clientSecret, code }),
    signal: AbortSignal.timeout(15_000),
    cache: "no-store",
  });
  const data = (await response.json().catch(() => null)) as { access_token?: string; error_description?: string } | null;
  if (!response.ok || !data?.access_token) {
    throw new GithubError(response.ok ? 400 : response.status, data?.error_description ?? "GitHub didn't confirm the sign-in.");
  }
  return data.access_token;
}

/** Whether that person can reach the installation, so nobody can link an installation that isn't theirs. */
export async function userCanUseInstallation(userToken: string, installationId: string) {
  for (let page = 1; page <= 10; page += 1) {
    const data = await request<{ installations: Array<{ id: number }> }>(`/user/installations?per_page=100&page=${page}`, userToken);
    if (data.installations.some((installation) => String(installation.id) === installationId)) return true;
    if (data.installations.length < 100) return false;
  }
  return false;
}

export function installUrl(state: string) {
  return `https://github.com/apps/${encodeURIComponent(githubApp.slug ?? "")}/installations/new?state=${encodeURIComponent(state)}`;
}

export interface GithubRepository {
  fullName: string;
  private: boolean;
  defaultBranch: string;
  description: string | null;
  language: string | null;
  pushedAt: string | null;
}

/** Every repository the installation can reach, most recently pushed first. */
export async function listInstallationRepositories(installationId: string, limit = 300): Promise<GithubRepository[]> {
  const repositories: GithubRepository[] = [];
  for (let page = 1; repositories.length < limit && page <= 10; page += 1) {
    const data = await githubRequest<{
      repositories: Array<{
        full_name: string;
        private: boolean;
        default_branch: string;
        description: string | null;
        language: string | null;
        pushed_at: string | null;
      }>;
    }>(installationId, `/installation/repositories?per_page=100&page=${page}`);
    for (const repo of data.repositories) {
      repositories.push({
        fullName: repo.full_name,
        private: repo.private,
        defaultBranch: repo.default_branch,
        description: repo.description,
        language: repo.language,
        pushedAt: repo.pushed_at,
      });
    }
    if (data.repositories.length < 100) break;
  }
  return repositories.sort((a, b) => (Date.parse(b.pushedAt ?? "") || 0) - (Date.parse(a.pushedAt ?? "") || 0)).slice(0, limit);
}
