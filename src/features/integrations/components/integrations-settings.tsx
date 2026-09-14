"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { IconCheck, IconGithub, IconGlobe, IconWarning } from "@/components/ui/icons";
import { inputStyles } from "@/components/ui/input";
import { LocalTime } from "@/components/ui/local-time";
import { SettingsSection } from "@/features/settings/components/settings-chrome";
import { useWorkspace, useWorkspaceStore } from "@/features/workspace/store/workspace-provider";
import { getErrorMessage } from "@/lib/errors";
import { cn, nameOf } from "@/lib/utils";
import type { Integration } from "@/types/domain";

import { listGithubRepositories, type RepositoryOption } from "../actions";
import { disconnectIntegration, githubInstallPath, setDefaultRepository } from "../api";
import { WebhooksSettings } from "./webhooks-settings";

export interface IntegrationStatus {
  connected: string | null;
  error: string | null;
  notice: string | null;
}

const PROBLEMS: Record<string, string> = {
  github_unavailable: "GitHub isn’t set up on this server yet.",
  github_incomplete: "GitHub didn’t finish installing the app. Try again.",
  github_no_code:
    "GitHub didn’t confirm who installed the app. In the GitHub App’s settings, turn on “Request user authorization (OAuth) during installation”, then connect again.",
  github_forbidden: "That GitHub installation belongs to an account you can’t manage.",
  github_failed: "Couldn’t connect GitHub. Try again.",
  not_admin: "Only workspace admins can connect apps.",
};

const STEPS = [
  "Connect GitHub and choose which repositories the app can see.",
  "Turn on “Work in GitHub” for an engineering agent.",
  "Ask it in any chat, like “@dev fix the login redirect”, then review the pull request it opens.",
];

export function IntegrationsSettings({ status }: { status: IntegrationStatus }) {
  const router = useRouter();
  const pathname = usePathname();
  const announced = useRef(false);

  // The GitHub round trip comes back here with its outcome in the address; say it once, then tidy the address.
  useEffect(() => {
    if (announced.current || (!status.connected && !status.error && !status.notice)) return;
    announced.current = true;
    if (status.connected === "github") {
      toast.success("GitHub is connected.", { description: "Turn on “Work in GitHub” for the agents that should use it." });
    } else if (status.error) {
      toast.error(PROBLEMS[status.error] ?? "Something went wrong connecting that app.");
    } else if (status.notice === "github_requested") {
      toast("GitHub asked an organization owner to approve the app.", { description: "Once they approve it, connect again here." });
    }
    router.replace(pathname);
  }, [status, router, pathname]);

  return (
    <div>
      <GithubSection />
      <WebhooksSettings />
      <WebSection />
    </div>
  );
}

function GithubSection() {
  const store = useWorkspaceStore();
  const workspace = useWorkspace((state) => state.workspace);
  const myRole = useWorkspace((state) => state.myRole);
  const members = useWorkspace((state) => state.members);
  const githubAvailable = useWorkspace((state) => state.githubAvailable);
  const github = useWorkspace((state) => state.integrations.find((item) => item.provider === "github") ?? null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const isAdmin = myRole !== "member";

  async function disconnect() {
    try {
      await disconnectIntegration(workspace.id, "github");
      store.getState().setIntegrations(store.getState().integrations.filter((item) => item.provider !== "github"));
      toast.success("GitHub is disconnected.");
    } catch (error) {
      toast.error(getErrorMessage(error, "Couldn't disconnect GitHub."));
      throw error;
    }
  }

  const connector = github?.connectedBy ? members[github.connectedBy] : null;

  return (
    <SettingsSection
      title="GitHub"
      description="Agents with “Work in GitHub” read your code and open pull requests for your team to review. They never commit to the branch a pull request merges into."
    >
      <div className="overflow-hidden rounded-[20px] border border-line bg-surface">
        <div className="flex flex-wrap items-center gap-4 px-4 py-4">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-ink text-paper">
            <IconGithub size={22} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-[15px] font-semibold text-ink">
              GitHub
              {github ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-grass-tint px-2 py-0.5 text-[11px] font-medium text-[var(--grass-ink)]">
                  <IconCheck size={11} strokeWidth={2.2} />
                  Connected
                </span>
              ) : null}
            </p>
            <p className="mt-0.5 truncate text-[13px] text-ink-3">
              {github
                ? `${github.accountLogin || "An account"}${github.accountType ? ` · ${github.accountType.toLowerCase()}` : ""}`
                : "Not connected"}
            </p>
          </div>
          {github ? (
            isAdmin ? (
              <Button variant="secondary" size="sm" onClick={() => setConfirmDisconnect(true)}>
                Disconnect
              </Button>
            ) : null
          ) : isAdmin && githubAvailable ? (
            <Button size="sm" asChild>
              <a href={githubInstallPath(workspace.slug)}>Connect GitHub</a>
            </Button>
          ) : null}
        </div>

        {!githubAvailable ? (
          <div className="flex gap-2.5 border-t border-line bg-paper px-4 py-3 text-[13px] leading-relaxed text-ink-2">
            <IconWarning size={16} className="mt-0.5 shrink-0" />
            GitHub isn’t set up on this server yet. Whoever runs maeosan registers a GitHub App once; the README explains how.
          </div>
        ) : github ? (
          <div className="border-t border-line px-4">
            <Row label="Connected by">
              {connector ? nameOf(connector) : "A former member"} · <LocalTime iso={github.createdAt} format="list" />
            </Row>
            <Row label="Default repository">
              <DefaultRepository integration={github} editable={isAdmin} />
            </Row>
            <Row label="Repository access">
              <a
                href={
                  github.accountType === "Organization"
                    ? `https://github.com/organizations/${encodeURIComponent(github.accountLogin)}/settings/installations`
                    : "https://github.com/settings/installations"
                }
                target="_blank"
                rel="noreferrer"
                className="font-medium text-ink underline-offset-2 hover:underline"
              >
                Choose repositories on GitHub
              </a>
            </Row>
          </div>
        ) : !isAdmin ? (
          <p className="border-t border-line px-4 py-3 text-[13px] text-ink-3">Ask a workspace admin to connect GitHub.</p>
        ) : null}
      </div>

      <ol className="mt-5 grid gap-2 sm:grid-cols-3">
        {STEPS.map((step, index) => (
          <li key={step} className="rounded-[18px] border border-line bg-surface px-3.5 py-3">
            <span className="font-mono text-[11px] text-ink-3">{String(index + 1).padStart(2, "0")}</span>
            <p className="mt-1 text-[13.5px] leading-snug text-ink-2">{step}</p>
          </li>
        ))}
      </ol>

      <ConfirmDialog
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        title="Disconnect GitHub?"
        description="Agents stop reading code and opening pull requests in this workspace. Pull requests they already opened stay on GitHub. To remove the app entirely, uninstall it on GitHub too."
        confirmLabel="Disconnect"
        onConfirm={disconnect}
      />
    </SettingsSection>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-12 flex-wrap items-center justify-between gap-x-4 gap-y-1 border-b border-line py-2.5 last:border-b-0">
      <span className="text-[13px] text-ink-3">{label}</span>
      <span className="min-w-0 text-right text-[13px] text-ink-2">{children}</span>
    </div>
  );
}

function DefaultRepository({ integration, editable }: { integration: Integration; editable: boolean }) {
  const store = useWorkspaceStore();
  const [repositories, setRepositories] = useState<RepositoryOption[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!editable) return;
    let cancelled = false;
    listGithubRepositories(integration.workspaceId)
      .then((result) => {
        if (cancelled) return;
        if (result.ok) setRepositories(result.data);
        else setProblem(result.error);
      })
      .catch(() => {
        if (!cancelled) setProblem("Couldn’t reach GitHub.");
      });
    return () => {
      cancelled = true;
    };
  }, [editable, integration.workspaceId, integration.id]);

  if (!editable) return <span className="font-mono text-[12.5px]">{integration.defaultRepo ?? "None"}</span>;
  if (problem) return <span className="text-danger">{problem}</span>;

  async function choose(repo: string | null) {
    setSaving(true);
    try {
      await setDefaultRepository(integration.workspaceId, repo);
      store
        .getState()
        .setIntegrations(store.getState().integrations.map((item) => (item.id === integration.id ? { ...item, defaultRepo: repo } : item)));
      toast.success(repo ? `Agents use ${repo} when nobody names a repository.` : "No default repository now.");
    } catch (error) {
      toast.error(getErrorMessage(error, "Couldn't save that."));
    } finally {
      setSaving(false);
    }
  }

  const known = repositories?.some((repo) => repo.fullName === integration.defaultRepo);
  return (
    <select
      value={integration.defaultRepo ?? ""}
      disabled={!repositories || saving}
      onChange={(event) => void choose(event.target.value || null)}
      aria-label="Default repository"
      className={cn(inputStyles, "h-9 max-w-[260px] py-0 font-mono text-[12.5px]")}
    >
      <option value="">{repositories ? "No default" : "Loading…"}</option>
      {integration.defaultRepo && !known ? <option value={integration.defaultRepo}>{integration.defaultRepo}</option> : null}
      {(repositories ?? []).map((repo) => (
        <option key={repo.fullName} value={repo.fullName}>
          {repo.fullName}
          {repo.private ? " (private)" : ""}
        </option>
      ))}
    </select>
  );
}

function WebSection() {
  const aiWebSearch = useWorkspace((state) => state.aiWebSearch);
  return (
    <SettingsSection title="Web" description="Agents with “Search the web” look things up, read pages people share, and link their sources.">
      <div className="flex items-center gap-4 rounded-[20px] border border-line bg-surface px-4 py-4">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-[14px] bg-paper-2 text-ink">
          <IconGlobe size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[15px] font-semibold text-ink">Web search</p>
          <p className="mt-0.5 text-[13px] leading-relaxed text-ink-3">
            {aiWebSearch
              ? "Included, with no setup. Each search uses a few credits from the person who asked."
              : "Agents can read links people share. Searching the web isn’t available on this server right now."}
          </p>
        </div>
        {aiWebSearch ? <span className="shrink-0 rounded-full bg-grass-tint px-2 py-0.5 text-[11px] font-medium text-[var(--grass-ink)]">On</span> : null}
      </div>
    </SettingsSection>
  );
}
