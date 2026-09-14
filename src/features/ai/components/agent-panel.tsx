"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { IconArrowRight, IconCheck, IconClose } from "@/components/ui/icons";
import { Switch } from "@/components/ui/switch";
import { useWorkspace, useWorkspaceStore } from "@/features/workspace/store/workspace-provider";
import { personColorStyle } from "@/lib/colors";
import { getErrorMessage } from "@/lib/errors";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import type { Agent, AgentToolId, Conversation, Specialty } from "@/types/domain";

import { createAgent } from "../actions";
import { AGENT_TOOLS, type AgentDraft } from "../agent-spec";
import { addAgentToConversation, AiRequestError, draftAgent, removeAgentFromConversation } from "../api";
import { creditsForUsage, formatCredits } from "../credits";
import { AI_MODELS, findModel, pickArchitectModel, recommendModel, type AiModel } from "../models";
import { routeModel } from "../router";
import { SPECIALTY_PROFILES } from "../specialties";
import { AgentAvatar, AgentGlyphMark, AgentTag } from "./agent-avatar";
import { GlyphShuffle } from "./glyph-shuffle";
import { AUTO_MODEL, ModelMenu } from "./model-menu";
import { SpecialtyChips } from "./specialty-chips";

type Stage =
  | { name: "home" }
  | { name: "drafting"; prompt: string }
  | { name: "review"; draft: AgentDraft; architectModel: string; credits: number; prompt: string };

const TOOL_SHORT: Record<AgentToolId, string> = {
  history: "Earlier messages",
  search: "Workspace search",
  directory: "Team directory",
  web: "Web search",
  tasks: "Tasks",
  github: "GitHub",
};

interface AgentPanelProps {
  conversation: Conversation;
  /** From "/agent …": drafting starts straight away. */
  initialPrompt?: string;
  onClose: () => void;
  /** Puts "@handle " into the message bar. */
  onMention: (agent: Agent) => void;
}

/**
 * Everything about agents without leaving the chat: describe a new one and
 * create it in a few seconds, bring existing agents into this chat, or mention
 * the ones already here.
 */
export function AgentPanel({ conversation, initialPrompt, onClose, onMention }: AgentPanelProps) {
  const store = useWorkspaceStore();
  const workspace = useWorkspace((state) => state.workspace);
  const agents = useWorkspace((state) => state.agents);
  const aiReady = useWorkspace((state) => state.aiReady);
  const aiModels = useWorkspace((state) => state.aiModels);
  const balance = useWorkspace((state) => state.credits?.balance ?? null);
  const panelRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const autoStarted = useRef(false);

  const [prompt, setPrompt] = useState(initialPrompt ?? "");
  const [specialty, setSpecialty] = useState<Specialty | null>(null);
  const [stage, setStage] = useState<Stage>({ name: "home" });
  const [error, setError] = useState<string | null>(null);

  const available = useMemo(() => AI_MODELS.filter((model) => aiModels.includes(model.id)), [aiModels]);
  const canCreate = aiReady && available.length > 0;
  const inRoom = Boolean(conversation.agentId);
  const joined = conversation.agentIds.map((id) => agents[id]).filter((agent): agent is Agent => Boolean(agent && !agent.archivedAt));
  const addable = inRoom
    ? []
    : Object.values(agents)
        .filter((agent) => !agent.archivedAt && agent.visibility === "workspace" && !conversation.agentIds.includes(agent.id))
        .sort((a, b) => a.name.localeCompare(b.name));
  const architect = pickArchitectModel(available);
  const estimate = architect ? creditsForUsage(architect, { inputTokens: 3000, outputTokens: 1400 }) : null;

  const draft = useCallback(
    async (request: string) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setError(null);
      setStage({ name: "drafting", prompt: request });
      try {
        const result = await draftAgent({ workspaceId: workspace.id, prompt: request, specialty }, controller.signal);
        if (controller.signal.aborted) return;
        setStage({ name: "review", draft: result.draft, architectModel: result.model, credits: result.credits, prompt: request });
      } catch (caught) {
        if (controller.signal.aborted) return;
        setError(caught instanceof AiRequestError ? caught.message : getErrorMessage(caught, "Couldn't draft that agent."));
        setStage({ name: "home" });
      }
    },
    [workspace.id, specialty],
  );

  // "/agent something" in the message bar starts drafting without another click.
  useEffect(() => {
    if (autoStarted.current || !initialPrompt || initialPrompt.trim().length < 6 || !canCreate) return;
    autoStarted.current = true;
    const request = initialPrompt.trim();
    queueMicrotask(() => void draft(request));
  }, [initialPrompt, canCreate, draft]);

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target || panelRef.current?.contains(target)) return;
      if (target.closest("[data-agent-panel-toggle]") || target.closest("[data-radix-popper-content-wrapper]")) return;
      onClose();
    };
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || document.querySelector("[data-radix-popper-content-wrapper]")) return;
      onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  async function join(agent: Agent, quiet = false) {
    const previous = store.getState().conversations[conversation.id]?.agentIds ?? conversation.agentIds;
    if (!previous.includes(agent.id)) store.getState().patchConversation(conversation.id, { agentIds: [...previous, agent.id] });
    try {
      await addAgentToConversation(conversation.id, agent.id);
      if (!quiet) toast.success(`${agent.name} joined the chat.`);
      return true;
    } catch (caught) {
      store.getState().patchConversation(conversation.id, { agentIds: previous });
      toast.error(getErrorMessage(caught, "Couldn't add that agent."));
      return false;
    }
  }

  async function leave(agent: Agent) {
    const previous = conversation.agentIds;
    store.getState().patchConversation(conversation.id, { agentIds: previous.filter((id) => id !== agent.id) });
    try {
      await removeAgentFromConversation(conversation.id, agent.id);
    } catch (caught) {
      store.getState().patchConversation(conversation.id, { agentIds: previous });
      toast.error(getErrorMessage(caught, "Couldn't remove that agent."));
    }
  }

  async function finish(agent: Agent, addToChat: boolean) {
    const added = addToChat ? await join(agent, true) : false;
    onMention(agent);
    onClose();
    toast.success(added ? `${agent.name} is ready and joined the chat.` : `${agent.name} is ready. Mention @${agent.handle} in any chat.`);
  }

  function submitDraft() {
    const request = prompt.trim();
    if (!canCreate) return;
    if (request.length < 6) {
      setError("Say a little more about what it should do.");
      return;
    }
    void draft(request);
  }

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Agents"
      className="absolute inset-x-0 bottom-full z-30 mb-2 flex max-h-[min(72vh,640px)] animate-pop-in flex-col overflow-hidden rounded-[24px] border border-line bg-surface shadow-pop [--avatar-ring:var(--surface)]"
    >
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <p className="font-display text-[16px] font-semibold tracking-[-0.01em]">{stage.name === "review" ? "Meet your new agent" : "Agents"}</p>
        {balance !== null ? <span className="font-mono text-[11px] text-ink-3">{formatCredits(balance)} credits</span> : null}
        <span className="flex-1" />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="flex size-7 items-center justify-center rounded-full text-ink-3 transition-colors hover:bg-paper hover:text-ink"
        >
          <IconClose size={15} />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {stage.name === "drafting" ? (
          <div className="flex flex-col items-center px-6 py-9 text-center">
            <GlyphShuffle />
            <p className="mt-6 font-display text-[18px] font-semibold tracking-[-0.01em]">Designing your agent…</p>
            <p className="mt-1 line-clamp-2 max-w-[460px] text-[13.5px] text-ink-3">“{stage.prompt}”</p>
            <Button
              variant="ghost"
              size="sm"
              className="mt-4"
              onClick={() => {
                abortRef.current?.abort();
                setStage({ name: "home" });
              }}
            >
              Cancel
            </Button>
          </div>
        ) : stage.name === "review" ? (
          <Review
            key={stage.architectModel + stage.draft.handle}
            stage={stage}
            available={available}
            balance={balance}
            inRoom={inRoom}
            onBack={() => setStage({ name: "home" })}
            onCreated={(agent, addToChat) => void finish(agent, addToChat)}
          />
        ) : (
          <div className="flex flex-col gap-2 p-3">
            <form
              onSubmit={(event) => {
                event.preventDefault();
                submitDraft();
              }}
              className="rounded-[18px] border border-line bg-paper p-3"
            >
              <label htmlFor="new-agent-prompt" className="flex items-center gap-2 text-[13px] font-medium text-ink">
                <span className="flex size-5 items-center justify-center rounded-[6px] bg-ink text-paper">
                  <AgentGlyphMark glyph="spark" className="size-3.5" />
                </span>
                Create an agent
              </label>
              <textarea
                id="new-agent-prompt"
                autoFocus
                rows={2}
                value={prompt}
                maxLength={2000}
                disabled={!canCreate}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                    event.preventDefault();
                    submitDraft();
                  }
                }}
                placeholder={canCreate ? "Describe what it should do and who it helps" : "AI agents aren’t available right now."}
                className="mt-2 w-full resize-none bg-transparent text-[15px] leading-relaxed text-ink outline-none placeholder:text-ink-4 disabled:cursor-not-allowed"
              />
              <SpecialtyChips value={specialty} onChange={setSpecialty} disabled={!canCreate} className="mt-1" />
              <div className="mt-3 flex items-center justify-between gap-3">
                <span className="font-mono text-[11px] text-ink-3">{estimate ? `≈ ${estimate} credits to draft` : null}</span>
                <Button type="submit" size="sm" disabled={!canCreate || prompt.trim().length < 6}>
                  Draft agent
                  <IconArrowRight size={14} />
                </Button>
              </div>
              {error ? (
                <p role="alert" className="mt-2 text-[13px] text-danger">
                  {error}
                </p>
              ) : null}
            </form>

            {joined.length > 0 ? (
              <PanelSection title="In this chat">
                {joined.map((agent) => (
                  <AgentRow
                    key={agent.id}
                    agent={agent}
                    hint="Mention"
                    onSelect={() => {
                      onMention(agent);
                      onClose();
                    }}
                    action={{ label: "Remove", run: () => void leave(agent) }}
                  />
                ))}
              </PanelSection>
            ) : null}

            {addable.length > 0 ? (
              <PanelSection title="Add to this chat">
                {addable.slice(0, 6).map((agent) => (
                  <AgentRow
                    key={agent.id}
                    agent={agent}
                    hint="Add"
                    onSelect={async () => {
                      if (await join(agent)) {
                        onMention(agent);
                        onClose();
                      }
                    }}
                  />
                ))}
              </PanelSection>
            ) : null}

            {inRoom ? (
              <p className="px-3 text-[12.5px] leading-relaxed text-ink-3">
                This is a private chat with one agent. @mention another agent to bring it in for a message.
              </p>
            ) : null}

            <Link
              href={routes.agents(workspace.slug)}
              onClick={onClose}
              className="flex items-center justify-between rounded-xl px-3 py-2 text-[13px] text-ink-2 transition-colors hover:bg-paper hover:text-ink"
            >
              All agents
              <IconArrowRight size={14} />
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="animate-fade-in">
      <p className="px-3 pb-1 pt-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">{title}</p>
      <div className="flex flex-col">{children}</div>
    </section>
  );
}

function AgentRow({
  agent,
  hint,
  onSelect,
  action,
}: {
  agent: Agent;
  hint: string;
  onSelect: () => void;
  action?: { label: string; run: () => void };
}) {
  return (
    <div className="group flex items-center rounded-xl transition-colors hover:bg-paper [&:hover]:[--avatar-ring:var(--paper)]">
      <button type="button" onClick={onSelect} className="flex min-w-0 flex-1 items-center gap-3 px-2.5 py-2 text-left">
        <AgentAvatar agent={agent} size="sm" />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline gap-2">
            <span className="truncate text-[14px] font-medium text-ink">{agent.name}</span>
            <span className="shrink-0 font-mono text-[11px] text-ink-3">@{agent.handle}</span>
          </span>
          <span className="block truncate text-[12.5px] text-ink-3">{agent.tagline || SPECIALTY_PROFILES[agent.specialty].summary}</span>
        </span>
        <span className="shrink-0 text-[12px] font-medium text-ink-3 opacity-0 transition-opacity group-hover:opacity-100">{hint}</span>
      </button>
      {action ? (
        <button
          type="button"
          onClick={action.run}
          className="mr-2 shrink-0 rounded-full px-2 py-1 text-[12px] text-ink-3 transition-colors hover:bg-paper-2 hover:text-danger"
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}

function Review({
  stage,
  available,
  balance,
  inRoom,
  onBack,
  onCreated,
}: {
  stage: Extract<Stage, { name: "review" }>;
  available: readonly AiModel[];
  balance: number | null;
  inRoom: boolean;
  onBack: () => void;
  onCreated: (agent: Agent, addToChat: boolean) => void;
}) {
  const store = useWorkspaceStore();
  const workspace = useWorkspace((state) => state.workspace);
  const webSearchOn = useWorkspace((state) => state.aiWebSearch);
  const { draft } = stage;
  const [name, setName] = useState(draft.name);
  const [handle, setHandle] = useState(draft.handle);
  const [tools, setTools] = useState<AgentToolId[]>(() => (webSearchOn ? draft.tools : draft.tools.filter((tool) => tool !== "web")));
  const [model, setModel] = useState(AUTO_MODEL);
  const [addToChat, setAddToChat] = useState(!inRoom);
  const [showInstructions, setShowInstructions] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const profile = SPECIALTY_PROFILES[draft.specialty];
  const autoPick = routeModel({
    text: draft.starters[0] ?? draft.tagline,
    specialty: draft.specialty,
    style: draft.responseStyle,
    mode: "auto",
    agentModel: "",
    wantsWeb: tools.includes("web"),
    balance,
    available,
  });
  const knowledgeNotes = draft.knowledge.split("\n").filter((line) => line.trim()).length;

  async function create() {
    setSaving(true);
    setError(null);
    const fallback = recommendModel("balanced", available)?.id ?? available[0]?.id ?? "claude-sonnet-5";
    const result = await createAgent({
      workspaceId: workspace.id,
      name,
      handle,
      tagline: draft.tagline,
      instructions: draft.instructions,
      knowledge: draft.knowledge,
      specialty: draft.specialty,
      responseStyle: draft.responseStyle,
      modelMode: model === AUTO_MODEL ? "auto" : "fixed",
      model: model === AUTO_MODEL ? fallback : model,
      tools,
      starters: draft.starters,
      color: draft.color,
      glyph: draft.glyph,
      visibility: "workspace",
    });
    if (!result.ok) {
      setSaving(false);
      setError(result.fieldErrors?.handle ?? result.fieldErrors?.name ?? result.fieldErrors?.model ?? result.error);
      return;
    }
    store.getState().upsertAgent(result.data);
    onCreated(result.data, addToChat && !inRoom);
  }

  return (
    <div className="p-4" style={personColorStyle(draft.color)}>
      <div className="flex items-start gap-4">
        <AgentAvatar agent={{ name, color: draft.color, glyph: draft.glyph }} size="xl" className="animate-agent-land" />
        <div className="min-w-0 flex-1 animate-rise [animation-delay:120ms]">
          <div className="flex items-center gap-2">
            <input
              value={name}
              maxLength={40}
              onChange={(event) => setName(event.target.value)}
              aria-label="Agent name"
              className="min-w-0 flex-1 rounded-lg bg-transparent font-display text-[22px] font-semibold tracking-[-0.02em] text-ink outline-none focus:bg-paper"
            />
            <AgentTag />
          </div>
          <label className="mt-0.5 flex items-center font-mono text-[12.5px] text-ink-3">
            @
            <input
              value={handle}
              maxLength={24}
              onChange={(event) => setHandle(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
              aria-label="Handle"
              className="min-w-0 flex-1 rounded bg-transparent text-ink-2 outline-none focus:bg-paper"
            />
          </label>
          <p className="mt-2 text-[14px] leading-snug text-ink-2">{draft.tagline}</p>
        </div>
      </div>

      <div className="mt-4 flex animate-rise flex-wrap items-center gap-1.5 [animation-delay:180ms]">
        <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-person-tint px-2.5 text-[12px] font-medium text-person-ink">
          <AgentGlyphMark glyph={profile.glyph} className="size-3.5" />
          {profile.label}
        </span>
        <ModelMenu
          value={model}
          onChange={setModel}
          available={available}
          autoHint={autoPick?.model.label}
          label={model === AUTO_MODEL ? "Auto model" : (findModel(model)?.label ?? model)}
          className="h-7 border border-line px-2.5 text-[12px] font-medium text-ink-2 hover:border-line-2"
        />
        {AGENT_TOOLS.filter((tool) => tool.id !== "web" || webSearchOn).map((tool) => {
          const on = tools.includes(tool.id);
          return (
            <button
              key={tool.id}
              type="button"
              aria-pressed={on}
              title={tool.description}
              onClick={() => setTools(on ? tools.filter((id) => id !== tool.id) : [...tools, tool.id])}
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-[12px] transition-colors duration-150",
                on ? "border-ink bg-ink text-paper" : "border-line text-ink-3 hover:border-line-2 hover:text-ink-2",
              )}
            >
              {on ? <IconCheck size={12} strokeWidth={2.2} /> : null}
              {TOOL_SHORT[tool.id]}
            </button>
          );
        })}
      </div>

      <div className="mt-4 animate-rise rounded-2xl border border-line bg-paper px-3.5 py-3 [animation-delay:240ms]">
        <div className="flex items-center justify-between gap-3">
          <span className="text-[12px] font-medium text-ink-2">How it will work</span>
          <button type="button" onClick={() => setShowInstructions((open) => !open)} className="text-[12px] text-ink-3 hover:text-ink">
            {showInstructions ? "Show less" : "Read all"}
          </button>
        </div>
        <p className={cn("mt-1.5 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-2", !showInstructions && "line-clamp-3")}>
          {draft.instructions}
        </p>
        {knowledgeNotes > 0 ? (
          <p className="mt-2 text-[12px] text-ink-3">
            Plus {knowledgeNotes} {knowledgeNotes === 1 ? "fact" : "facts"} from your description it will always get right.
          </p>
        ) : null}
      </div>

      {!inRoom ? (
        <label className="mt-4 flex animate-rise cursor-pointer items-center justify-between gap-4 px-1 [animation-delay:300ms]">
          <span>
            <span className="block text-[13.5px] font-medium text-ink">Add to this chat</span>
            <span className="block text-[12px] text-ink-3">Works here alongside everyone. Each reply uses the credits of whoever asked.</span>
          </span>
          <Switch checked={addToChat} onCheckedChange={setAddToChat} />
        </label>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 text-[13px] text-danger">
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <span className="min-w-0 truncate font-mono text-[11px] text-ink-3">
          Drafted with {findModel(stage.architectModel)?.label ?? stage.architectModel} · {formatCredits(stage.credits)} credits
        </span>
        <span className="flex-1" />
        <Button variant="ghost" size="sm" onClick={onBack} disabled={saving}>
          Start over
        </Button>
        <Button variant="ghost" size="sm" asChild>
          <Link href={routes.newAgent(workspace.slug, stage.prompt)}>More options</Link>
        </Button>
        <Button size="sm" onClick={() => void create()} loading={saving} disabled={name.trim().length < 2 || handle.length < 3}>
          Create agent
        </Button>
      </div>
    </div>
  );
}
