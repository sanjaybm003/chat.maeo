"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, FormError, SectionLabel } from "@/components/ui/field";
import { IconArrowLeft, IconCheck, IconLock, IconWarning } from "@/components/ui/icons";
import { Input, Textarea } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { useOpenConversation } from "@/features/workspace/hooks/use-open-conversation";
import { useWorkspace, useWorkspaceStore } from "@/features/workspace/store/workspace-provider";
import { useServerAction } from "@/hooks/use-server-action";
import { PERSON_COLOR_LABELS, personColorStyle } from "@/lib/colors";
import { getErrorMessage } from "@/lib/errors";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import {
  AGENT_GLYPHS,
  PERSON_COLORS,
  type Agent,
  type AgentGlyph,
  type AgentToolId,
  type AgentVisibility,
  type ModelMode,
  type PersonColor,
  type ResponseStyle,
  type Specialty,
} from "@/types/domain";

import { archiveAgent, createAgent, updateAgent } from "../actions";
import { AGENT_TOOLS, MAX_KNOWLEDGE, MAX_STARTERS, toHandle, type AgentDraft, type AgentInput } from "../agent-spec";
import { AiRequestError, draftAgent, openAgentConversation } from "../api";
import { creditsForUsage, formatCredits, typicalReplyCredits } from "../credits";
import { AI_MODELS, findModel, pickArchitectModel, PROVIDERS, recommendModel, TIER_LABELS, type AiModel, type ModelTier } from "../models";
import { modelForTier } from "../router";
import { RESPONSE_STYLE_OPTIONS, SPECIALTY_LIST, SPECIALTY_PROFILES } from "../specialties";
import { AgentAvatar, AgentGlyphMark, AgentTag, GLYPH_LABELS } from "./agent-avatar";
import { GlyphShuffle } from "./glyph-shuffle";
import { SpecialtyChips } from "./specialty-chips";

interface FormState {
  name: string;
  handle: string;
  /** Once someone types a handle, renaming the agent stops rewriting it. */
  handleEdited: boolean;
  tagline: string;
  instructions: string;
  knowledge: string;
  specialty: Specialty;
  responseStyle: ResponseStyle;
  modelMode: ModelMode;
  model: string;
  tools: AgentToolId[];
  starters: string[];
  color: PersonColor;
  glyph: AgentGlyph;
  visibility: AgentVisibility;
}

function blankForm(model: string): FormState {
  const profile = SPECIALTY_PROFILES.assistant;
  return {
    name: "",
    handle: "",
    handleEdited: false,
    tagline: "",
    instructions: "",
    knowledge: "",
    specialty: profile.id,
    responseStyle: profile.style,
    modelMode: "auto",
    model,
    tools: profile.tools,
    starters: [],
    color: profile.color,
    glyph: profile.glyph,
    visibility: "workspace",
  };
}

const formFromAgent = (agent: Agent): FormState => ({
  name: agent.name,
  handle: agent.handle,
  handleEdited: true,
  tagline: agent.tagline,
  instructions: agent.instructions,
  knowledge: agent.knowledge,
  specialty: agent.specialty,
  responseStyle: agent.responseStyle,
  modelMode: agent.modelMode,
  model: agent.model,
  tools: agent.tools,
  starters: agent.starters,
  color: agent.color,
  glyph: agent.glyph,
  visibility: agent.visibility,
});

const toDraft = (form: FormState): AgentDraft => ({
  name: form.name,
  handle: form.handle,
  tagline: form.tagline,
  instructions: form.instructions,
  knowledge: form.knowledge,
  specialty: form.specialty,
  responseStyle: form.responseStyle,
  tools: form.tools,
  starters: form.starters.filter((starter) => starter.trim()),
  color: form.color,
  glyph: form.glyph,
});

const toInput = (form: FormState, workspaceId: string): AgentInput => ({
  workspaceId,
  name: form.name,
  handle: form.handle,
  tagline: form.tagline,
  instructions: form.instructions,
  knowledge: form.knowledge,
  specialty: form.specialty,
  responseStyle: form.responseStyle,
  modelMode: form.modelMode,
  model: form.model,
  tools: form.tools,
  starters: form.starters.map((starter) => (starter ?? "").trim()).filter(Boolean),
  color: form.color,
  glyph: form.glyph,
  visibility: form.visibility,
});

export function AgentBuilder({ agentId, initialPrompt }: { agentId?: string; initialPrompt?: string }) {
  const store = useWorkspaceStore();
  const router = useRouter();
  const openConversation = useOpenConversation();
  const workspace = useWorkspace((state) => state.workspace);
  const meId = useWorkspace((state) => state.me.id);
  const myRole = useWorkspace((state) => state.myRole);
  const aiReady = useWorkspace((state) => state.aiReady);
  const aiModels = useWorkspace((state) => state.aiModels);
  const existing = useWorkspace((state) => (agentId ? state.agents[agentId] : undefined));

  const available = useMemo(() => AI_MODELS.filter((model) => aiModels.includes(model.id)), [aiModels]);
  const [form, setForm] = useState<FormState>(() =>
    existing ? formFromAgent(existing) : blankForm(recommendModel("balanced", available)?.id ?? "claude-sonnet-5"),
  );

  const [prompt, setPrompt] = useState(initialPrompt ?? "");
  const [refinement, setRefinement] = useState("");
  const [draftSpecialty, setDraftSpecialty] = useState<Specialty | null>(null);
  const [drafting, setDrafting] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftedBy, setDraftedBy] = useState<{ model: string; credits: number } | null>(null);
  const [reveal, setReveal] = useState(0);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const autoDrafted = useRef(false);

  const saveAction = useCallback(
    (input: AgentInput) => (existing ? updateAgent(existing.id, input) : createAgent(input)),
    [existing],
  );
  const save = useServerAction(saveAction);

  const patch = (next: Partial<FormState>) => setForm((current) => ({ ...current, ...next }));
  const canEdit = !existing || (!existing.archivedAt && (existing.createdBy === meId || myRole !== "member"));
  const hasBlueprint = Boolean(existing) || draftedBy !== null;
  const canDraft = aiReady && available.length > 0 && !drafting;

  const runDraft = useCallback(
    async (request: string, current: AgentDraft | null) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setDrafting(true);
      setDraftError(null);
      try {
        const result = await draftAgent({ workspaceId: workspace.id, prompt: request, specialty: draftSpecialty, current }, controller.signal);
        const { draft } = result;
        setForm((previous) => ({
          ...previous,
          name: draft.name,
          // An existing agent keeps its handle, so mentions people already use keep working.
          handle: existing ? previous.handle : draft.handle,
          handleEdited: Boolean(existing),
          tagline: draft.tagline,
          instructions: draft.instructions,
          knowledge: draft.knowledge,
          specialty: draft.specialty,
          responseStyle: draft.responseStyle,
          tools: draft.tools,
          starters: draft.starters,
          color: draft.color,
          glyph: draft.glyph,
        }));
        setDraftedBy({ model: result.model, credits: result.credits });
        setRefinement("");
        setReveal((value) => value + 1);
      } catch (error) {
        if (controller.signal.aborted) return;
        setDraftError(error instanceof AiRequestError ? error.message : getErrorMessage(error, "Couldn't draft that agent."));
      } finally {
        if (abortRef.current === controller) {
          abortRef.current = null;
          setDrafting(false);
        }
      }
    },
    [workspace.id, existing, draftSpecialty],
  );

  // Arriving with a description (from the Agents page or the message bar): start drafting straight away.
  useEffect(() => {
    if (autoDrafted.current || existing || !initialPrompt || initialPrompt.trim().length < 6) return;
    if (!aiReady || available.length === 0) return;
    autoDrafted.current = true;
    const request = initialPrompt.trim();
    queueMicrotask(() => void runDraft(request, null));
  }, [existing, initialPrompt, aiReady, available.length, runDraft]);

  useEffect(() => () => abortRef.current?.abort(), []);

  if (agentId && !existing) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="font-display text-2xl font-semibold tracking-[-0.02em]">This agent isn’t available.</p>
        <p className="max-w-sm text-sm text-ink-3">It may be private to the person who made it, or it was removed.</p>
        <Button asChild variant="secondary" className="mt-2">
          <Link href={routes.agents(workspace.slug)}>Back to agents</Link>
        </Button>
      </div>
    );
  }

  function handleDraft() {
    const request = (hasBlueprint ? refinement : prompt).trim();
    if (request.length < 6) {
      setDraftError("Say a little more about the agent.");
      return;
    }
    const current = hasBlueprint && form.instructions.trim().length >= 20 ? toDraft(form) : null;
    void runDraft(request, current);
  }

  function draftOnModEnter(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (canDraft) handleDraft();
    }
  }

  /** On a fresh form, a work type also brings its usual tools, look and reply style. */
  function chooseSpecialty(specialty: Specialty) {
    const profile = SPECIALTY_PROFILES[specialty];
    const pristine = !hasBlueprint && !form.instructions.trim();
    setForm((current) =>
      pristine
        ? { ...current, specialty, tools: profile.tools, responseStyle: profile.style, color: profile.color, glyph: profile.glyph }
        : { ...current, specialty },
    );
  }

  async function submit() {
    const result = await save.run(toInput(form, workspace.id));
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    store.getState().upsertAgent(result.data);
    if (existing) {
      toast.success(`${result.data.name} is updated.`);
      router.push(routes.agents(workspace.slug));
      return;
    }
    toast.success(`${result.data.name} is ready. Mention @${result.data.handle} in any chat.`);
    try {
      await openConversation(await openAgentConversation(result.data.id));
    } catch {
      router.push(routes.agents(workspace.slug));
    }
  }

  async function archive() {
    if (!existing) return;
    const result = await archiveAgent(existing.id);
    if (!result.ok) {
      toast.error(result.error);
      throw new Error(result.error);
    }
    store.getState().upsertAgent(result.data);
    toast.success(`${result.data.name} was archived.`);
    router.push(routes.agents(workspace.slug));
  }

  const model = findModel(form.model);
  const architect = pickArchitectModel(available);
  const draftEstimate = architect ? creditsForUsage(architect, { inputTokens: 3000, outputTokens: 1400 }) : null;
  const starters = Array.from({ length: MAX_STARTERS }, (_, index) => form.starters[index] ?? "");
  const errors = save.fieldErrors;
  const fixedUnavailable = form.modelMode === "fixed" && !available.some((item) => item.id === form.model);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[1180px] px-5 pt-5 sm:px-10 sm:pt-8">
        <Link
          href={routes.agents(workspace.slug)}
          className="inline-flex h-9 items-center gap-1.5 rounded-full pl-2 pr-3 text-[13.5px] text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink"
        >
          <IconArrowLeft size={16} />
          Agents
        </Link>

        <p className="mt-5 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">{existing ? "Agent blueprint" : "New agent"}</p>
        <h1 className="mt-2 font-display text-[40px] font-semibold leading-none tracking-[-0.04em]">
          {existing ? existing.name : "Build an agent"}
        </h1>

        {!canEdit ? (
          <p className="mt-6 flex items-center gap-2 rounded-2xl border border-line bg-surface px-4 py-3 text-[13.5px] text-ink-2">
            <IconLock size={15} className="shrink-0" />
            {existing?.archivedAt ? "This agent is archived." : "Only the person who made this agent, or an admin, can change it."}
          </p>
        ) : null}

        <div className="mt-8 grid items-start gap-8 pb-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-10">
          <aside className="flex flex-col gap-4 lg:sticky lg:top-6">
            {canEdit ? (
              <section className="overflow-hidden rounded-[24px] border border-line bg-surface">
                <div className="p-5">
                  <p className="font-display text-[19px] font-semibold tracking-[-0.01em]">
                    {hasBlueprint ? "Change it with words" : "Describe it"}
                  </p>
                  <p className="mt-1 text-[13.5px] leading-relaxed text-ink-3">
                    {hasBlueprint
                      ? "Say what to change. The blueprint updates; nothing is saved until you save."
                      : "What should it do, who is it for, and what should it always know? Plain words work best."}
                  </p>
                  <Textarea
                    value={hasBlueprint ? refinement : prompt}
                    onChange={(event) => (hasBlueprint ? setRefinement(event.target.value) : setPrompt(event.target.value))}
                    onKeyDown={draftOnModEnter}
                    rows={hasBlueprint ? 3 : 6}
                    maxLength={2000}
                    disabled={!aiReady || available.length === 0}
                    placeholder={
                      hasBlueprint
                        ? "What should be different?"
                        : "Describe the job, the people it helps, how replies should look, and any facts it must know."
                    }
                    aria-label={hasBlueprint ? "What to change" : "Describe the agent"}
                    className="mt-4 text-[15px]"
                  />
                  {!hasBlueprint ? (
                    <SpecialtyChips value={draftSpecialty} onChange={setDraftSpecialty} disabled={!canDraft} className="mt-3" />
                  ) : null}
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="min-w-0 truncate font-mono text-[11px] text-ink-3">
                      {draftedBy
                        ? `Drafted with ${findModel(draftedBy.model)?.label ?? draftedBy.model} · ${formatCredits(draftedBy.credits)} credits`
                        : draftEstimate
                          ? `About ${draftEstimate} credits`
                          : null}
                    </span>
                    <Button onClick={handleDraft} loading={drafting} disabled={!canDraft}>
                      {hasBlueprint ? "Revise" : "Draft agent"}
                    </Button>
                  </div>
                  {draftError ? (
                    <div className="mt-3">
                      <FormError message={draftError} />
                    </div>
                  ) : null}
                </div>
                {drafting ? (
                  <div className="flex items-center gap-4 border-t border-line bg-paper px-5 py-4">
                    <GlyphShuffle className="scale-[0.62] origin-left -my-3 -mr-9" />
                    <p className="text-[13.5px] text-ink-2">{hasBlueprint ? "Revising the blueprint…" : "Designing your agent…"}</p>
                  </div>
                ) : null}
              </section>
            ) : null}

            <ChatPreview form={form} />
          </aside>

          <fieldset key={reveal} disabled={!canEdit} className="flex min-w-0 flex-col gap-11">
            <BuilderSection index={0} title="Identity" description="How the team sees it and calls it.">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Name" htmlFor="agent-name" error={errors.name}>
                  <Input
                    id="agent-name"
                    value={form.name}
                    maxLength={40}
                    onChange={(event) => {
                      const name = event.target.value;
                      patch({ name, ...(form.handleEdited ? {} : { handle: name.trim() ? toHandle(name) : "" }) });
                    }}
                    aria-invalid={Boolean(errors.name)}
                  />
                </Field>
                <Field label="Handle" htmlFor="agent-handle" error={errors.handle} hint="What people type to call it.">
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 font-mono text-[14px] text-ink-3">@</span>
                    <Input
                      id="agent-handle"
                      value={form.handle}
                      maxLength={24}
                      onChange={(event) =>
                        patch({ handle: event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""), handleEdited: true })
                      }
                      className="pl-8 font-mono text-[14px]"
                      aria-invalid={Boolean(errors.handle)}
                    />
                  </div>
                </Field>
                <Field label="Tagline" htmlFor="agent-tagline" error={errors.tagline} className="sm:col-span-2">
                  <Input id="agent-tagline" value={form.tagline} maxLength={120} onChange={(event) => patch({ tagline: event.target.value })} />
                </Field>
              </div>
            </BuilderSection>

            <BuilderSection index={1} title="Work type" description="Each type comes with a proven way of working, so replies are sharper for that job.">
              <div role="radiogroup" aria-label="Work type" className="grid gap-2 sm:grid-cols-2">
                {SPECIALTY_LIST.map((profile) => {
                  const selected = form.specialty === profile.id;
                  return (
                    <button
                      key={profile.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => chooseSpecialty(profile.id)}
                      style={personColorStyle(profile.color)}
                      className={cn(
                        "group flex items-start gap-3 rounded-2xl border bg-surface p-3 text-left transition-[border-color,box-shadow] duration-150",
                        selected ? "border-ink shadow-[0_0_0_1px_var(--ink)]" : "border-line hover:border-line-2",
                      )}
                    >
                      <span
                        className={cn(
                          "flex size-9 shrink-0 items-center justify-center rounded-[11px] transition-[background-color,color,transform] duration-200 group-hover:rotate-6",
                          selected ? "bg-person text-person-on" : "bg-person-tint text-person-ink",
                        )}
                      >
                        <AgentGlyphMark glyph={profile.glyph} className="size-5" />
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[14px] font-semibold text-ink">{profile.label}</span>
                        <span className="block text-[12.5px] leading-snug text-ink-3">{profile.summary}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </BuilderSection>

            <BuilderSection index={2} title="Look" description="Agents wear a mark, never a face, so nobody mistakes one for a person.">
              <div className="flex flex-col gap-5">
                <div>
                  <p className="mb-2.5 text-[13px] font-medium text-ink-2">Color</p>
                  <div role="radiogroup" aria-label="Color" className="flex flex-wrap gap-2.5">
                    {PERSON_COLORS.map((color) => {
                      const selected = form.color === color;
                      return (
                        <button
                          key={color}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          aria-label={PERSON_COLOR_LABELS[color]}
                          title={PERSON_COLOR_LABELS[color]}
                          onClick={() => patch({ color })}
                          className={cn(
                            "flex size-9 items-center justify-center rounded-[11px] transition-transform duration-150 hover:scale-105",
                            selected && "ring-2 ring-ink ring-offset-[3px] ring-offset-paper",
                          )}
                          style={{ backgroundColor: `var(--${color})`, color: `var(--${color}-on)` }}
                        >
                          {selected ? <IconCheck size={16} strokeWidth={2.2} /> : null}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div>
                  <p className="mb-2.5 text-[13px] font-medium text-ink-2">Mark</p>
                  <div role="radiogroup" aria-label="Mark" className="flex flex-wrap gap-2.5" style={personColorStyle(form.color)}>
                    {AGENT_GLYPHS.map((glyph) => {
                      const selected = form.glyph === glyph;
                      return (
                        <button
                          key={glyph}
                          type="button"
                          role="radio"
                          aria-checked={selected}
                          aria-label={GLYPH_LABELS[glyph]}
                          title={GLYPH_LABELS[glyph]}
                          onClick={() => patch({ glyph })}
                          className={cn(
                            "flex size-12 items-center justify-center rounded-[14px] border transition-[background-color,border-color,color,transform] duration-150 hover:-rotate-6",
                            selected ? "border-transparent bg-person text-person-on" : "border-line bg-surface text-ink-2 hover:border-line-2",
                          )}
                        >
                          <AgentGlyphMark glyph={glyph} className="size-7" />
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>
            </BuilderSection>

            <BuilderSection index={3} title="Instructions" description="Written to the agent. Say what it does, what a great reply looks like, and where its limits are.">
              <Field
                label="Instructions"
                htmlFor="agent-instructions"
                error={errors.instructions}
                aside={
                  <span className={cn("font-mono text-[11px]", form.instructions.length > 8000 ? "text-danger" : "text-ink-3")}>
                    {form.instructions.length.toLocaleString()} / 8,000
                  </span>
                }
              >
                <Textarea
                  id="agent-instructions"
                  value={form.instructions}
                  onChange={(event) => patch({ instructions: event.target.value })}
                  rows={12}
                  className="min-h-[280px] text-[14.5px]"
                  aria-invalid={Boolean(errors.instructions)}
                />
              </Field>
            </BuilderSection>

            <BuilderSection
              index={4}
              title="Team knowledge"
              description="Facts it must always get right: product names, prices, policies, links, who owns what. It prefers these over guessing. Optional."
            >
              <Field
                label="Knowledge"
                htmlFor="agent-knowledge"
                error={errors.knowledge}
                aside={
                  <span className={cn("font-mono text-[11px]", form.knowledge.length > MAX_KNOWLEDGE ? "text-danger" : "text-ink-3")}>
                    {form.knowledge.length.toLocaleString()} / 8,000
                  </span>
                }
              >
                <Textarea
                  id="agent-knowledge"
                  value={form.knowledge}
                  onChange={(event) => patch({ knowledge: event.target.value })}
                  rows={6}
                  placeholder="One fact per line"
                  className="min-h-[150px] text-[14px]"
                />
              </Field>
            </BuilderSection>

            <BuilderSection
              index={5}
              title="Model and replies"
              description="Every reply is paid from the credits of the person who asks. Auto keeps quick answers cheap and saves the strongest models for hard questions."
            >
              <Segmented<ModelMode>
                label="Model choice"
                value={form.modelMode}
                onChange={(modelMode) => patch({ modelMode })}
                options={[
                  { value: "auto", label: "Auto, per message" },
                  { value: "fixed", label: "Always one model" },
                ]}
              />
              {form.modelMode === "auto" ? (
                <AutoPreview specialty={form.specialty} available={available} />
              ) : available.length === 0 ? (
                <p className="mt-4 rounded-2xl border border-dashed border-line-2 px-4 py-6 text-center text-[13.5px] text-ink-3">
                  No models are available right now.
                </p>
              ) : (
                <div className="mt-4">
                  {fixedUnavailable && existing ? (
                    <p className="mb-4 flex items-start gap-2 rounded-2xl bg-danger-tint px-3.5 py-2.5 text-[13.5px] text-danger">
                      <IconWarning size={16} className="mt-px shrink-0" />
                      {findModel(form.model)?.label ?? form.model} isn’t available right now. Choose another model or switch to Auto.
                    </p>
                  ) : null}
                  <ModelPicker value={form.model} available={available} onChange={(id) => patch({ model: id })} />
                </div>
              )}
              {errors.model ? <p className="mt-2 text-[13px] text-danger">{errors.model}</p> : null}

              <div className="mt-7">
                <p className="mb-2.5 text-[13px] font-medium text-ink-2">Reply style</p>
                <Segmented<ResponseStyle>
                  label="Reply style"
                  value={form.responseStyle}
                  onChange={(responseStyle) => patch({ responseStyle })}
                  options={(["concise", "balanced", "detailed"] as const).map((value) => ({ value, label: RESPONSE_STYLE_OPTIONS[value].label }))}
                />
                <p className="mt-2 text-[12.5px] text-ink-3">{RESPONSE_STYLE_OPTIONS[form.responseStyle].summary}</p>
              </div>
            </BuilderSection>

            <BuilderSection index={6} title="Tools" description="What it may look at while it works. Everything stays within what the people in the chat can already see.">
              <div className="divide-y divide-line overflow-hidden rounded-[20px] border border-line bg-surface">
                {AGENT_TOOLS.map((tool) => {
                  const unsupported = tool.id === "web" && form.modelMode === "fixed" && !model?.webSearch;
                  const checked = form.tools.includes(tool.id) && !unsupported;
                  return (
                    <label key={tool.id} className={cn("flex items-center justify-between gap-4 px-4 py-3.5", unsupported ? "opacity-55" : "cursor-pointer")}>
                      <span className="min-w-0">
                        <span className="block text-[14px] font-medium text-ink">{tool.label}</span>
                        <span className="block text-[12.5px] text-ink-3">
                          {unsupported ? "The chosen model can’t browse. Pick a Claude model or use Auto." : tool.description}
                        </span>
                      </span>
                      <Switch
                        checked={checked}
                        disabled={unsupported}
                        onCheckedChange={(value) =>
                          patch({ tools: value ? [...form.tools, tool.id] : form.tools.filter((id) => id !== tool.id) })
                        }
                      />
                    </label>
                  );
                })}
              </div>
            </BuilderSection>

            <BuilderSection index={7} title="Conversation starters" description="Shown in its room as one-tap first messages. Optional.">
              <div className="flex flex-col gap-2">
                {starters.map((starter, index) => (
                  <Input
                    key={index}
                    value={starter}
                    maxLength={120}
                    onChange={(event) => {
                      const next = [...starters];
                      next[index] = event.target.value;
                      patch({ starters: next });
                    }}
                    aria-label={`Conversation starter ${index + 1}`}
                  />
                ))}
              </div>
            </BuilderSection>

            <BuilderSection index={8} title="Who can use it" description="Shared agents can also be added to any chat, where they work alongside everyone.">
              <Segmented<AgentVisibility>
                label="Who can use it"
                value={form.visibility}
                onChange={(visibility) => patch({ visibility })}
                options={[
                  { value: "workspace", label: "Everyone in the workspace" },
                  { value: "private", label: "Only me" },
                ]}
              />
            </BuilderSection>
          </fieldset>
        </div>
      </div>

      {canEdit ? (
        <div className="sticky bottom-0 z-10 border-t border-line bg-paper">
          <div className="mx-auto flex w-full max-w-[1180px] items-center gap-3 px-5 py-3 sm:px-10">
            {existing ? (
              <Button variant="danger-ghost" onClick={() => setConfirmArchive(true)}>
                Archive
              </Button>
            ) : null}
            <p className="min-w-0 flex-1 truncate text-[13px] text-danger" role="alert">
              {save.error ?? ""}
            </p>
            <Button variant="ghost" asChild>
              <Link href={routes.agents(workspace.slug)}>Cancel</Link>
            </Button>
            <Button onClick={() => void submit()} loading={save.pending} disabled={drafting || !aiReady}>
              {existing ? "Save changes" : "Create agent"}
            </Button>
          </div>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmArchive}
        onOpenChange={setConfirmArchive}
        title={`Archive ${existing?.name ?? "this agent"}?`}
        description="It stops replying, leaves every chat it was added to, and disappears from @mentions. Its past replies stay."
        confirmLabel="Archive"
        onConfirm={archive}
      />
    </div>
  );
}

function BuilderSection({
  index,
  title,
  description,
  children,
}: {
  index: number;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="animate-rise" style={{ animationDelay: `${index * 55}ms` }}>
      <div className="mb-4 flex items-baseline gap-3">
        <span className="font-mono text-[11px] text-ink-3">{String(index + 1).padStart(2, "0")}</span>
        <div>
          <h2 className="font-display text-[19px] font-semibold tracking-[-0.01em]">{title}</h2>
          {description ? <p className="mt-0.5 text-[13.5px] leading-relaxed text-ink-3">{description}</p> : null}
        </div>
      </div>
      {children}
    </section>
  );
}

function ChatPreview({ form }: { form: FormState }) {
  const profile = SPECIALTY_PROFILES[form.specialty];
  return (
    <section className="rounded-[24px] border border-line bg-surface p-5" style={personColorStyle(form.color)}>
      <SectionLabel>In chat</SectionLabel>
      <div className="mt-4 flex gap-2.5">
        <AgentAvatar key={`${form.glyph}-${form.color}`} agent={form} size="md" className="animate-agent-land" />
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[13px] font-semibold text-person-ink">
            <span className="truncate">{form.name.trim() || "Unnamed agent"}</span>
            <AgentTag />
          </p>
          <p className="mt-1 rounded-[20px] rounded-bl-[6px] border border-line bg-surface-2 px-3.5 py-2 text-[14px] leading-snug text-ink-2">
            {form.tagline.trim() || profile.summary}
          </p>
        </div>
      </div>
      <p className="mt-4 text-[12.5px] text-ink-3">
        Call it in any chat with <span className="rounded-md bg-paper-2 px-1.5 py-0.5 font-mono text-[12px] text-ink-2">@{form.handle || "handle"}</span>,
        or add it to a chat from the ✦ button in the message bar.
      </p>
    </section>
  );
}

const TIER_USES: Record<ModelTier, string> = {
  fast: "Quick questions",
  balanced: "Everyday work",
  deep: "Hard problems",
};

/** What Auto would use for this work type, from light to careful. */
function AutoPreview({ specialty, available }: { specialty: Specialty; available: readonly AiModel[] }) {
  if (available.length === 0) {
    return <p className="mt-4 text-[13.5px] text-ink-3">No models are available right now.</p>;
  }
  return (
    <div className="mt-4 overflow-hidden rounded-[20px] border border-line bg-surface">
      {(["fast", "balanced", "deep"] as const).map((tier, index) => {
        const model = modelForTier(tier, specialty, available);
        return (
          <div key={tier} className="flex items-center gap-3 border-b border-line px-4 py-3 last:border-b-0">
            <span className="flex h-3.5 w-6 shrink-0 items-end gap-[3px]" aria-hidden="true">
              {[0, 1, 2].map((bar) => (
                <span
                  key={bar}
                  className={cn("w-[5px] rounded-full", bar <= index ? "bg-meter" : "bg-meter-track")}
                  style={{ height: `${(bar + 1) * 4 + 2}px` }}
                />
              ))}
            </span>
            <span className="w-[118px] shrink-0 text-[13.5px] text-ink">{TIER_USES[tier]}</span>
            <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">
              {model ? `${model.label} · ${PROVIDERS[model.provider].label}` : "Not available"}
            </span>
            {model ? <span className="shrink-0 font-mono text-[11px] text-ink-3">≈ {typicalReplyCredits(model)} credits</span> : null}
          </div>
        );
      })}
    </div>
  );
}

function ModelPicker({ value, available, onChange }: { value: string; available: readonly AiModel[]; onChange: (id: string) => void }) {
  const tiers = (["fast", "balanced", "deep"] as const satisfies readonly ModelTier[]).filter((tier) =>
    available.some((model) => model.tier === tier),
  );

  return (
    <div role="radiogroup" aria-label="Model" className="flex flex-col gap-5">
      {tiers.map((tier) => (
        <div key={tier}>
          <p className="mb-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">{TIER_LABELS[tier]}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {available
              .filter((model) => model.tier === tier)
              .map((model) => {
                const selected = value === model.id;
                return (
                  <button
                    key={model.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => onChange(model.id)}
                    className={cn(
                      "flex flex-col items-start gap-1 rounded-2xl border bg-surface p-3.5 text-left transition-[border-color,box-shadow] duration-150",
                      selected ? "border-ink shadow-[0_0_0_1px_var(--ink)]" : "border-line hover:border-line-2",
                    )}
                  >
                    <span className="flex w-full items-baseline justify-between gap-2">
                      <span className="text-[14px] font-semibold text-ink">{model.label}</span>
                      <span className="shrink-0 font-mono text-[10.5px] text-ink-3">{PROVIDERS[model.provider].label}</span>
                    </span>
                    <span className="text-[12.5px] leading-snug text-ink-3">{model.summary}</span>
                    <span className="mt-1 font-mono text-[11px] text-ink-2">
                      ≈ {typicalReplyCredits(model)} credits a reply{model.preview ? " · preview" : ""}
                    </span>
                  </button>
                );
              })}
          </div>
        </div>
      ))}
    </div>
  );
}
