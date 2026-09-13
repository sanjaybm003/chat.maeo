"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Avatar } from "@/components/ui/avatar";
import { IconWarning } from "@/components/ui/icons";
import { LocalTime } from "@/components/ui/local-time";
import { Segmented } from "@/components/ui/segmented";
import { SettingsSection } from "@/features/settings/components/settings-chrome";
import { useWorkspace, useWorkspaceStore } from "@/features/workspace/store/workspace-provider";
import { cn, nameOf, pluralize } from "@/lib/utils";
import type { CreditAccount, UsageBucket, UsageSummary } from "@/types/domain";

import { fetchRecentRuns, fetchUsageSummary, type RecentRun } from "../api";
import { CREDITS_PER_USD, formatCredits, typicalReplyCredits } from "../credits";
import { fillDays } from "../lib/usage";
import { AI_MODELS, findModel, PROVIDERS, TIER_LABELS } from "../models";
import { AgentAvatar } from "./agent-avatar";
import { creditTotal, LOW_CREDIT_SHARE } from "./credits-meter";
import { UsageChart, UsageTable } from "./usage-chart";

type Range = "7" | "30" | "90";

const STATUS_LABEL: Record<RecentRun["status"], string> = {
  running: "In progress",
  succeeded: "Done",
  failed: "Failed",
  cancelled: "Stopped",
};

export function CreditsSettings() {
  const store = useWorkspaceStore();
  const workspace = useWorkspace((state) => state.workspace);
  const credits = useWorkspace((state) => state.credits);
  const aiReady = useWorkspace((state) => state.aiReady);
  const [range, setRange] = useState<Range>("30");
  const [view, setView] = useState<"chart" | "table">("chart");
  const [data, setData] = useState<{ key: string; summary: UsageSummary; runs: RecentRun[] } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const loadedOnce = useRef(false);

  const key = `${workspace.id}:${range}:${attempt}`;
  const balance = credits?.balance;

  // Reloads when the range changes, and shortly after credits move, so the page follows replies as they finish.
  useEffect(() => {
    if (!aiReady) return;
    let cancelled = false;
    const timer = window.setTimeout(
      async () => {
        try {
          const [summary, runs] = await Promise.all([fetchUsageSummary(workspace.id, Number(range)), fetchRecentRuns(workspace.id, 30)]);
          if (cancelled) return;
          loadedOnce.current = true;
          setData({ key, summary, runs });
          if (summary.account) store.getState().setCredits(summary.account);
        } catch {
          if (!cancelled) setFailedKey(key);
        }
      },
      loadedOnce.current ? 700 : 0,
    );
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [aiReady, workspace.id, range, key, balance, store]);

  const summary = data?.key === key ? data.summary : null;
  const runs = data?.runs ?? null;
  const series = useMemo(() => fillDays(summary?.days ?? [], Number(range)), [summary, range]);
  const rangeCredits = series.reduce((sum, day) => sum + day.credits, 0);
  const rangeRuns = series.reduce((sum, day) => sum + day.runs, 0);

  if (!aiReady) {
    return (
      <SettingsSection title="AI credits" description="Agents and credits aren’t set up on this database yet.">
        <p className="text-[14px] leading-relaxed text-ink-2">
          Run <code className="font-mono text-[13px]">supabase/migrations/20260915000100_ai_agents.sql</code> in the Supabase SQL editor, then
          reload. Every workspace then starts with 10,000 credits.
        </p>
      </SettingsSection>
    );
  }

  return (
    <>
      <SettingsSection
        title="Balance"
        description={
          <>
            Shared by everyone in {workspace.name}. One credit is about $0.001 of model usage at provider list prices. Every workspace starts
            with 10,000.
          </>
        }
      >
        {credits ? <BalanceHero credits={credits} /> : <div className="h-28 animate-pulse rounded-2xl bg-paper-2" />}
      </SettingsSection>

      <SettingsSection title="Usage" description="Credits spent each day, in your time zone.">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Segmented<Range>
            size="sm"
            label="Time range"
            value={range}
            onChange={setRange}
            options={[
              { value: "7", label: "7 days" },
              { value: "30", label: "30 days" },
              { value: "90", label: "90 days" },
            ]}
          />
          <Segmented<"chart" | "table">
            size="sm"
            label="Show as"
            value={view}
            onChange={setView}
            options={[
              { value: "chart", label: "Chart" },
              { value: "table", label: "Table" },
            ]}
          />
        </div>

        <div className="mt-5">
          {!summary && failedKey === key ? (
            <p className="rounded-2xl border border-dashed border-line-2 px-4 py-8 text-center text-[13.5px] text-ink-3">
              Usage didn’t load.{" "}
              <button type="button" className="font-medium text-ink underline-offset-2 hover:underline" onClick={() => setAttempt((value) => value + 1)}>
                Try again
              </button>
            </p>
          ) : !summary ? (
            <div className="h-[200px] animate-pulse rounded-2xl bg-paper-2" />
          ) : rangeRuns === 0 ? (
            <p className="rounded-2xl border border-dashed border-line-2 px-4 py-10 text-center text-[13.5px] leading-relaxed text-ink-3">
              No AI usage in this period. Mention an agent in any chat and its replies show up here.
            </p>
          ) : view === "chart" ? (
            <UsageChart series={series} />
          ) : (
            <UsageTable series={series} />
          )}
        </div>

        {summary && rangeRuns > 0 ? (
          <p className="mt-3 font-mono text-[11.5px] text-ink-2">
            {formatCredits(rangeCredits)} credits · {pluralize(rangeRuns, "run")} in the last {range} days
          </p>
        ) : null}
      </SettingsSection>

      <SettingsSection title="Where it went" description={`By agent and by person, over the last ${range} days.`}>
        {summary ? <Breakdown summary={summary} /> : <div className="h-24 animate-pulse rounded-2xl bg-paper-2" />}
      </SettingsSection>

      <SettingsSection title="Recent runs" description="Every agent reply and draft, newest first.">
        {runs === null ? <div className="h-24 animate-pulse rounded-2xl bg-paper-2" /> : <RunsTable runs={runs} />}
      </SettingsSection>

      <SettingsSection
        title="Models"
        description="What each model costs and whether this server can use it. Prices are provider list prices per million tokens."
      >
        <ModelsTable />
      </SettingsSection>
    </>
  );
}

function BalanceHero({ credits }: { credits: CreditAccount }) {
  const total = creditTotal(credits);
  const leftShare = Math.min(1, Math.max(0, credits.balance / total));
  const heldShare = Math.min(1 - leftShare, Math.max(0, credits.reserved / total));

  return (
    <div>
      <p className="font-display text-[56px] font-semibold leading-none tracking-[-0.04em] text-ink">{formatCredits(credits.balance)}</p>
      <p className="mt-2 text-[14px] text-ink-2">credits left of {formatCredits(total)}</p>

      <div
        role="meter"
        aria-label="AI credits left"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={credits.balance}
        className="mt-6 flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-meter-track"
      >
        <span className="h-full rounded-full bg-meter transition-[width] duration-500" style={{ width: `${leftShare * 100}%` }} />
        {heldShare > 0 ? <span className="h-full rounded-full bg-meter opacity-40" style={{ width: `${heldShare * 100}%` }} /> : null}
      </div>

      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[13px]">
        <div className="flex gap-1.5">
          <dt className="text-ink-3">Used</dt>
          <dd className="font-mono tabular-nums text-ink-2">{formatCredits(credits.lifetimeUsed)}</dd>
        </div>
        {credits.reserved > 0 ? (
          <div className="flex gap-1.5">
            <dt className="text-ink-3">Held for replies in progress</dt>
            <dd className="font-mono tabular-nums text-ink-2">{formatCredits(credits.reserved)}</dd>
          </div>
        ) : null}
        <div className="flex gap-1.5">
          <dt className="text-ink-3">Worth about</dt>
          <dd className="font-mono tabular-nums text-ink-2">${(credits.balance / CREDITS_PER_USD).toFixed(2)}</dd>
        </div>
      </dl>

      {leftShare < LOW_CREDIT_SHARE ? (
        <p className="mt-5 flex items-center gap-2 rounded-2xl bg-danger-tint px-3.5 py-2.5 text-[13.5px] text-danger">
          <IconWarning size={16} className="shrink-0" />
          {credits.balance <= 0 ? "Credits are used up. Agents can’t reply until more are added." : "Credits are running low."}
        </p>
      ) : null}
    </div>
  );
}

function ShareBar({ value, max }: { value: number; max: number }) {
  return (
    <span className="block h-2 overflow-hidden rounded-full bg-meter-track">
      <span className="block h-full rounded-full bg-meter" style={{ width: `${max > 0 ? Math.max(2, (value / max) * 100) : 0}%` }} />
    </span>
  );
}

function Breakdown({ summary }: { summary: UsageSummary }) {
  const agents = useWorkspace((state) => state.agents);
  const members = useWorkspace((state) => state.members);
  const meId = useWorkspace((state) => state.me.id);

  const byAgent = summary.agents.filter((row) => row.runs > 0);
  const byPerson = summary.people.filter((row) => row.runs > 0);
  if (byAgent.length === 0 && byPerson.length === 0) {
    return <p className="text-[13.5px] text-ink-3">Nothing to break down yet.</p>;
  }
  const agentMax = Math.max(...byAgent.map((row) => row.credits), 0);
  const personMax = Math.max(...byPerson.map((row) => row.credits), 0);

  const row = (key: string, leading: React.ReactNode, label: string, bucket: UsageBucket, max: number) => (
    <li key={key} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] items-center gap-4">
      <span className="flex min-w-0 items-center gap-2.5">
        {leading}
        <span className="truncate text-[13.5px] text-ink">{label}</span>
      </span>
      <span className="flex items-center gap-3">
        <span className="min-w-0 flex-1">
          <ShareBar value={bucket.credits} max={max} />
        </span>
        <span className="w-[112px] shrink-0 text-right font-mono text-[11.5px] tabular-nums text-ink-2">
          {formatCredits(bucket.credits)} · {pluralize(bucket.runs, "run")}
        </span>
      </span>
    </li>
  );

  return (
    <div className="flex flex-col gap-8">
      {byAgent.length > 0 ? (
        <div>
          <p className="mb-3 text-[13px] font-medium text-ink-2">Agents</p>
          <ul className="flex flex-col gap-3">
            {byAgent.map((bucket) => {
              const agent = bucket.agentId ? agents[bucket.agentId] : null;
              const label = bucket.agentId ? (agent?.name ?? "Removed agent") : "Drafting new agents";
              const leading = bucket.agentId ? (
                <AgentAvatar agent={agent} size="xs" />
              ) : (
                <span className="size-5 shrink-0 rounded-[6px] border border-dashed border-line-2" aria-hidden="true" />
              );
              return row(bucket.agentId ?? "architect", leading, label, bucket, agentMax);
            })}
          </ul>
        </div>
      ) : null}
      {byPerson.length > 0 ? (
        <div>
          <p className="mb-3 text-[13px] font-medium text-ink-2">People</p>
          <ul className="flex flex-col gap-3">
            {byPerson.map((bucket) => {
              const person = bucket.userId ? (members[bucket.userId] ?? null) : null;
              const label = bucket.userId === meId ? "You" : nameOf(person);
              return row(bucket.userId ?? "former", <Avatar person={person} size="xs" />, label, bucket, personMax);
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function RunsTable({ runs }: { runs: RecentRun[] }) {
  const agents = useWorkspace((state) => state.agents);
  const members = useWorkspace((state) => state.members);
  const meId = useWorkspace((state) => state.me.id);

  if (runs.length === 0) return <p className="text-[13.5px] text-ink-3">No runs yet.</p>;

  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[580px] text-left text-[13px]">
        <thead>
          <tr className="border-b border-line-2 text-[12px] text-ink-2">
            <th className="px-1 py-2 font-medium">When</th>
            <th className="px-2 py-2 font-medium">Agent</th>
            <th className="px-2 py-2 font-medium">Asked by</th>
            <th className="px-2 py-2 font-medium">Model</th>
            <th className="px-2 py-2 font-medium">Status</th>
            <th className="px-1 py-2 text-right font-medium">Credits</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((run) => (
            <tr key={run.id} className="border-b border-line last:border-b-0">
              <td className="whitespace-nowrap px-1 py-2.5 text-ink-2">
                <LocalTime iso={run.createdAt} format="list" />
              </td>
              <td className="px-2 py-2.5 text-ink">
                {run.kind === "architect" ? "New agent draft" : run.agentId ? (agents[run.agentId]?.name ?? "Removed agent") : "Removed agent"}
              </td>
              <td className="px-2 py-2.5 text-ink-2">
                {run.triggeredBy === meId ? "You" : nameOf(run.triggeredBy ? members[run.triggeredBy] : null)}
              </td>
              <td className="whitespace-nowrap px-2 py-2.5 font-mono text-[12px] text-ink-2">{findModel(run.model)?.label ?? run.model}</td>
              <td className={cn("px-2 py-2.5", run.status === "failed" ? "text-danger" : "text-ink-2")}>{STATUS_LABEL[run.status]}</td>
              <td className="px-1 py-2.5 text-right font-mono tabular-nums text-ink">{formatCredits(run.credits)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ModelsTable() {
  const aiModels = useWorkspace((state) => state.aiModels);
  const price = (value: number) => `$${value < 1 ? value.toFixed(2) : value.toFixed(value % 1 ? 2 : 0)}`;

  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[620px] text-left text-[13px]">
        <thead>
          <tr className="border-b border-line-2 text-[12px] text-ink-2">
            <th className="px-1 py-2 font-medium">Model</th>
            <th className="px-2 py-2 font-medium">Tier</th>
            <th className="px-2 py-2 text-right font-medium">Input</th>
            <th className="px-2 py-2 text-right font-medium">Output</th>
            <th className="px-2 py-2 text-right font-medium">A reply</th>
            <th className="px-1 py-2 font-medium">On this server</th>
          </tr>
        </thead>
        <tbody>
          {AI_MODELS.map((model) => {
            const connected = aiModels.includes(model.id);
            return (
              <tr key={model.id} className="border-b border-line last:border-b-0">
                <td className="px-1 py-2.5">
                  <span className="block text-ink">{model.label}</span>
                  <span className="block text-[12px] text-ink-3">{PROVIDERS[model.provider].label}</span>
                </td>
                <td className="px-2 py-2.5 text-ink-2">{TIER_LABELS[model.tier]}</td>
                <td className="px-2 py-2.5 text-right font-mono tabular-nums text-ink-2">{price(model.inputPrice)}</td>
                <td className="px-2 py-2.5 text-right font-mono tabular-nums text-ink-2">{price(model.outputPrice)}</td>
                <td className="px-2 py-2.5 text-right font-mono tabular-nums text-ink">≈ {typicalReplyCredits(model)}</td>
                <td className="px-1 py-2.5 text-[12.5px]">
                  {connected ? (
                    <span className="text-ink-2">Connected</span>
                  ) : (
                    <span className="text-ink-3">
                      Add <code className="font-mono text-[11.5px]">{PROVIDERS[model.provider].envKey}</code>
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="mt-3 px-1 text-[12px] text-ink-3">“A reply” is a typical answer in a busy chat: about 4,000 tokens read and 500 written.</p>
    </div>
  );
}
