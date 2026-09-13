"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type KeyboardEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SectionLabel } from "@/components/ui/field";
import { IconArrowLeft, IconArrowRight, IconCopy, IconLock, IconMore, IconPencil, IconTrash, IconWarning } from "@/components/ui/icons";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { useWorkspace, useWorkspaceStore } from "@/features/workspace/store/workspace-provider";
import { personColorStyle } from "@/lib/colors";
import { routes } from "@/lib/routes";
import { cn, joinNames } from "@/lib/utils";
import { AGENT_GLYPHS, PERSON_COLORS, type Agent, type AgentToolId, type CreditAccount } from "@/types/domain";

import { archiveAgent } from "../actions";
import { creditsForUsage, formatCredits } from "../credits";
import { useOpenAgentRoom } from "../hooks/use-open-agent-room";
import { AI_MODELS, findModel, pickArchitectModel, PROVIDERS } from "../models";
import { AgentAvatar, AgentGlyphMark } from "./agent-avatar";
import { creditTotal } from "./credits-meter";

/** Starting points for the description box. They fill it in; nothing is created until the person drafts and saves. */
const IDEAS = [
  "Turns long threads into a short recap with decisions, owners and open questions",
  "Answers “how do we do this here?” using what the team has already said",
  "Rewrites rough drafts so they read clear, warm and confident",
  "Researches a topic on the web and reports back with sources",
];

const TOOL_CHIPS: Record<AgentToolId, string> = {
  history: "history",
  search: "search",
  directory: "team",
  web: "web",
};

export function AgentsScreen() {
  const router = useRouter();
  const workspace = useWorkspace((state) => state.workspace);
  const agents = useWorkspace((state) => state.agents);
  const aiReady = useWorkspace((state) => state.aiReady);
  const aiModels = useWorkspace((state) => state.aiModels);
  const credits = useWorkspace((state) => state.credits);
  const [prompt, setPrompt] = useState("");

  const active = Object.values(agents)
    .filter((agent) => !agent.archivedAt)
    .sort((a, b) => a.name.localeCompare(b.name));
  const available = AI_MODELS.filter((model) => aiModels.includes(model.id));
  const canBuild = aiReady && available.length > 0;
  const architect = pickArchitectModel(available);
  const estimate = architect ? creditsForUsage(architect, { inputTokens: 3000, outputTokens: 1400 }) : null;
  const ready = canBuild && prompt.trim().length >= 6;

  function draft() {
    if (ready) router.push(routes.newAgent(workspace.slug, prompt.trim()));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      draft();
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[1100px] px-5 pb-20 pt-5 sm:px-10 sm:pt-10">
        <Link
          href={routes.workspace(workspace.slug)}
          className="mb-4 inline-flex size-9 items-center justify-center rounded-full text-ink-2 hover:bg-paper-2 md:hidden"
          aria-label="Back to chats"
        >
          <IconArrowLeft />
        </Link>

        <div className="flex flex-wrap items-end justify-between gap-6">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">{workspace.name}</p>
            <h1 className="mt-2 font-display text-[44px] font-semibold leading-none tracking-[-0.04em]">Agents</h1>
            <p className="mt-3 max-w-[540px] text-[15px] leading-relaxed text-ink-3">
              Teammates made of instructions. Describe one in plain words, then @mention it in any chat or talk to it one-on-one.
            </p>
          </div>
          {credits ? <CreditsCard credits={credits} slug={workspace.slug} /> : null}
        </div>

        {!aiReady ? (
          <SetupNotice title="Agents need one database update">
            Run <code className="font-mono text-[12.5px]">supabase/migrations/20260915000100_ai_agents.sql</code> in the Supabase SQL
            editor, then reload this page.
          </SetupNotice>
        ) : available.length === 0 ? (
          <SetupNotice title="Connect a model provider">
            Add at least one of {joinNames(Object.values(PROVIDERS).map((provider) => provider.envKey), 4)} to the server’s environment
            and redeploy. Only models with a key are offered.
          </SetupNotice>
        ) : null}

        <section className="mt-9 overflow-hidden rounded-[28px] border border-line bg-surface">
          <div className="grid md:grid-cols-[minmax(0,1fr)_188px]">
            <div className="p-5 sm:p-7">
              <label htmlFor="describe-agent" className="font-display text-[22px] font-semibold tracking-[-0.02em]">
                Describe an agent
              </label>
              <p className="mt-1 text-[14px] text-ink-3">
                Say what it should do and who it helps. You’ll get a complete blueprint to adjust before anything is saved.
              </p>
              <textarea
                id="describe-agent"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={handleKeyDown}
                rows={3}
                maxLength={2000}
                disabled={!canBuild}
                placeholder="An agent that…"
                className="mt-5 w-full resize-none bg-transparent text-[18px] leading-relaxed text-ink outline-none placeholder:text-ink-4 disabled:cursor-not-allowed"
              />
              <div className="mt-2 flex flex-wrap gap-2">
                {IDEAS.map((idea) => (
                  <button
                    key={idea}
                    type="button"
                    disabled={!canBuild}
                    onClick={() => setPrompt(idea)}
                    className="rounded-full border border-line px-3 py-1.5 text-left text-[12.5px] leading-snug text-ink-2 transition-colors hover:border-line-2 hover:text-ink disabled:pointer-events-none disabled:opacity-50"
                  >
                    {idea}
                  </button>
                ))}
              </div>
              <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-line pt-4">
                <span className="font-mono text-[11px] text-ink-3">{estimate ? `Drafting costs about ${estimate} credits` : null}</span>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" asChild>
                    <Link href={routes.newAgent(workspace.slug)}>Start blank</Link>
                  </Button>
                  <Button onClick={draft} disabled={!ready}>
                    Draft agent
                    <IconArrowRight size={16} />
                  </Button>
                </div>
              </div>
            </div>
            <GlyphWall />
          </div>
        </section>

        <SectionLabel className="mt-12">
          {active.length === 0 ? "Your agents" : `${active.length} ${active.length === 1 ? "agent" : "agents"}`}
        </SectionLabel>

        {active.length === 0 ? (
          <div className="mt-4 rounded-[24px] border border-dashed border-line-2 px-6 py-14 text-center">
            <p className="font-display text-xl font-semibold">No agents yet.</p>
            <p className="mt-1 text-sm text-ink-3">Describe the first one above. Drafting takes a few seconds.</p>
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {active.map((agent) => (
              <AgentCard key={agent.id} agent={agent} connected={aiModels.includes(agent.model)} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function SetupNotice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-8 flex gap-3 rounded-[20px] border border-line bg-surface px-5 py-4">
      <IconWarning size={18} className="mt-0.5 shrink-0 text-ink-2" />
      <div>
        <p className="text-[14.5px] font-semibold text-ink">{title}</p>
        <p className="mt-1 text-[13.5px] leading-relaxed text-ink-2">{children}</p>
      </div>
    </div>
  );
}

/** The six agent marks in flat color: a quiet signature for the page. */
function GlyphWall() {
  return (
    <div className="hidden grid-cols-2 grid-rows-3 border-l border-line md:grid" aria-hidden="true">
      {AGENT_GLYPHS.map((glyph, index) => (
        <div
          key={glyph}
          className="flex min-h-[84px] items-center justify-center bg-person text-person-on"
          style={personColorStyle(PERSON_COLORS[(index * 3) % PERSON_COLORS.length])}
        >
          <AgentGlyphMark glyph={glyph} className="size-11" />
        </div>
      ))}
    </div>
  );
}

function CreditsCard({ credits, slug }: { credits: CreditAccount; slug: string }) {
  const total = creditTotal(credits);
  const share = Math.min(1, Math.max(0, credits.balance / total));
  return (
    <Link
      href={routes.settings(slug, "ai")}
      className="group flex w-full max-w-[260px] flex-col gap-2 rounded-2xl border border-line bg-surface px-4 py-3 transition-colors hover:border-line-2"
    >
      <span className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] text-ink-3">AI credits</span>
        <span className="font-display text-[22px] font-semibold leading-none tracking-[-0.02em] text-ink">{formatCredits(credits.balance)}</span>
      </span>
      <span
        role="meter"
        aria-label="AI credits left"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={credits.balance}
        className="block h-1.5 overflow-hidden rounded-full bg-meter-track"
      >
        <span className="block h-full rounded-full bg-meter" style={{ width: `${share * 100}%` }} />
      </span>
      <span className="text-[12px] text-ink-3 transition-colors group-hover:text-ink-2">of {formatCredits(total)} · see usage</span>
    </Link>
  );
}

function AgentCard({ agent, connected }: { agent: Agent; connected: boolean }) {
  const store = useWorkspaceStore();
  const router = useRouter();
  const meId = useWorkspace((state) => state.me.id);
  const myRole = useWorkspace((state) => state.myRole);
  const slug = useWorkspace((state) => state.workspace.slug);
  const openRoom = useOpenAgentRoom();
  const [confirmArchive, setConfirmArchive] = useState(false);

  const model = findModel(agent.model);
  const canEdit = agent.createdBy === meId || myRole !== "member";

  async function copyHandle() {
    try {
      await navigator.clipboard.writeText(`@${agent.handle}`);
      toast.success(`Copied @${agent.handle}. Paste it into any chat.`);
    } catch {
      toast.error("Couldn't copy the handle.");
    }
  }

  async function archive() {
    const result = await archiveAgent(agent.id);
    if (!result.ok) {
      toast.error(result.error);
      throw new Error(result.error);
    }
    store.getState().upsertAgent(result.data);
    toast.success(`${agent.name} was archived.`);
  }

  return (
    <article className="relative flex flex-col overflow-hidden rounded-[24px] border border-line bg-surface" style={personColorStyle(agent.color)}>
      <div className="relative h-[72px] overflow-hidden bg-person-tint" aria-hidden="true">
        <AgentGlyphMark glyph={agent.glyph} className="absolute -right-6 -top-10 size-36 text-person opacity-30" />
      </div>

      <div className="-mt-7 flex flex-1 flex-col px-4 pb-4">
        <div className="flex items-end justify-between">
          <AgentAvatar agent={agent} size="lg" className="ring-4 ring-surface" />
          <Menu>
            <MenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`More for ${agent.name}`}>
                <IconMore size={17} />
              </Button>
            </MenuTrigger>
            <MenuContent align="end">
              <MenuItem icon={<IconCopy size={16} />} onSelect={() => void copyHandle()}>
                Copy @{agent.handle}
              </MenuItem>
              {canEdit ? (
                <>
                  <MenuItem icon={<IconPencil size={16} />} onSelect={() => router.push(routes.agent(slug, agent.id))}>
                    Edit
                  </MenuItem>
                  <MenuSeparator />
                  <MenuItem tone="danger" icon={<IconTrash size={16} />} onSelect={() => setConfirmArchive(true)}>
                    Archive
                  </MenuItem>
                </>
              ) : (
                <MenuItem icon={<IconPencil size={16} />} onSelect={() => router.push(routes.agent(slug, agent.id))}>
                  View setup
                </MenuItem>
              )}
            </MenuContent>
          </Menu>
        </div>

        <h2 className="mt-3 flex items-center gap-1.5 text-[16px] font-semibold text-ink">
          {agent.name}
          {agent.visibility === "private" ? <IconLock size={13} className="text-ink-3" aria-label="Only its maker can use it" /> : null}
        </h2>
        <p className="font-mono text-[12px] text-ink-3">@{agent.handle}</p>
        <p className="mt-2 line-clamp-2 min-h-[40px] text-[13.5px] leading-snug text-ink-2">{agent.tagline || "No tagline yet."}</p>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 font-mono text-[10.5px]",
              connected ? "border-line text-ink-2" : "border-danger/40 text-danger",
            )}
            title={connected ? undefined : "This model isn't connected on the server, so the agent can't reply."}
          >
            {connected ? null : <IconWarning size={11} />}
            {model?.label ?? agent.model}
          </span>
          {agent.tools.map((tool) => (
            <span key={tool} className="rounded-full border border-line px-2 py-0.5 font-mono text-[10.5px] text-ink-3">
              {TOOL_CHIPS[tool]}
            </span>
          ))}
        </div>

        <div className="mt-auto pt-4">
          <Button size="sm" variant="secondary" className="w-full" onClick={() => void openRoom(agent.id)}>
            Chat with {agent.name}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmArchive}
        onOpenChange={setConfirmArchive}
        title={`Archive ${agent.name}?`}
        description="It stops replying and disappears from @mentions. Its past replies stay in every chat."
        confirmLabel="Archive"
        onConfirm={archive}
      />
    </article>
  );
}
