"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { toast } from "sonner";

import { IconButton } from "@/components/ui/icon-button";
import { IconArrowUp, IconClose, IconPaperclip, IconReply, IconSpark } from "@/components/ui/icons";
import { AgentAvatar } from "@/features/ai/components/agent-avatar";
import { AgentPanel } from "@/features/ai/components/agent-panel";
import { matchAgents, MentionMenu } from "@/features/ai/components/mention-menu";
import { AUTO_MODEL, ModelMenu } from "@/features/ai/components/model-menu";
import { plainText } from "@/features/ai/lib/rich-text";
import { activeMentionQuery, insertMention } from "@/features/ai/mentions";
import { AI_MODELS, findModel } from "@/features/ai/models";
import { routeModel } from "@/features/ai/router";
import { agentsToWake } from "@/features/ai/wake";
import { useWorkspace, useWorkspaceStore } from "@/features/workspace/store/workspace-provider";
import { personColorStyle } from "@/lib/colors";
import { MAX_MESSAGE_LENGTH } from "@/lib/constants";
import { usePreferences } from "@/lib/preferences";
import { cn, firstNameOf, joinNames, nameOf } from "@/lib/utils";
import type { Agent, Conversation } from "@/types/domain";

import type { AttachmentUploads } from "../hooks/use-attachment-uploads";
import { useMessageActions } from "../hooks/use-message-actions";
import { attachmentSummary, conversationTitle, directPartner } from "../lib/conversation-meta";
import { UploadTray } from "./attachments";

/** "/agent Keeps our launch notes…" opens the agent panel and starts drafting. */
const AGENT_COMMAND = /^\/agents?(?:\s+([\s\S]*))?$/i;

interface ComposerProps {
  conversation: Conversation;
  uploads: AttachmentUploads;
  onTyping: () => void;
  onStopTyping: () => void;
}

export function Composer({ conversation, uploads, onTyping, onStopTyping }: ComposerProps) {
  const conversationId = conversation.id;
  const store = useWorkspaceStore();
  const me = useWorkspace((state) => state.me);
  const members = useWorkspace((state) => state.members);
  const agents = useWorkspace((state) => state.agents);
  const aiReady = useWorkspace((state) => state.aiReady);
  const aiModels = useWorkspace((state) => state.aiModels);
  const balance = useWorkspace((state) => state.credits?.balance ?? null);
  const agentPanel = useWorkspace((state) => state.agentPanel);
  const openAgentPanel = useWorkspace((state) => state.openAgentPanel);
  const closeAgentPanel = useWorkspace((state) => state.closeAgentPanel);
  const replyToId = useWorkspace((state) => state.replyTargets[conversationId]);
  const replyTo = useWorkspace((state) =>
    replyToId ? (state.threads[conversationId]?.messages.find((message) => message.id === replyToId) ?? null) : null,
  );
  const [preferences] = usePreferences();
  const actions = useMessageActions(conversationId);
  const [text, setText] = useState(() => store.getState().drafts[conversationId] ?? "");
  const [caret, setCaret] = useState(() => text.length);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [dismissedMentionAt, setDismissedMentionAt] = useState<number | null>(null);
  const [replyModel, setReplyModel] = useState(AUTO_MODEL);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const available = useMemo(() => AI_MODELS.filter((model) => aiModels.includes(model.id)), [aiModels]);
  const panelOpen = agentPanel?.conversationId === conversationId;
  const readyAttachments = uploads.items.flatMap((item) => (item.status === "ready" && item.attachment ? [item.attachment] : []));
  const uploading = uploads.items.some((item) => item.status === "uploading");
  const tooLong = text.length > MAX_MESSAGE_LENGTH;
  const hasContent = text.trim().length > 0 || readyAttachments.length > 0;
  const canSend = hasContent && !uploading && !tooLong;
  const command = aiReady ? AGENT_COMMAND.exec(text.trim()) : null;

  // "@que" at the caret opens a picker of agents; Escape dismisses it for that mention only.
  const mention = aiReady && !panelOpen ? activeMentionQuery(text, caret) : null;
  const suggestions = mention && mention.start !== dismissedMentionAt ? matchAgents(agents, mention.query) : [];
  const mentionOpen = suggestions.length > 0;
  const activeMention = Math.min(mentionIndex, Math.max(suggestions.length - 1, 0));
  const woken = aiReady && text.trim() && !command ? agentsToWake(text, conversation, agents, replyTo) : [];
  const lead = woken[0];
  const autoPick = lead
    ? routeModel({
        text,
        specialty: lead.specialty,
        style: lead.responseStyle,
        mode: lead.modelMode,
        agentModel: lead.model,
        wantsWeb: lead.tools.includes("web"),
        balance,
        available,
      })
    : null;

  useLayoutEffect(() => {
    const element = textareaRef.current;
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${Math.min(element.scrollHeight, 220)}px`;
  }, [text]);

  useEffect(() => {
    if (window.matchMedia("(hover: hover)").matches) textareaRef.current?.focus();
  }, [conversationId, replyToId]);

  function focusAt(position: number) {
    requestAnimationFrame(() => {
      const element = textareaRef.current;
      if (!element) return;
      element.focus();
      element.setSelectionRange(position, position);
    });
  }

  function updateText(value: string, nextCaret: number) {
    setText(value);
    setCaret(nextCaret);
    store.getState().setDraft(conversationId, value);
    if (value) onTyping();
    else onStopTyping();
  }

  function pickMention(agent: Agent) {
    if (!mention) return;
    const next = insertMention(text, caret, mention.start, agent.handle);
    updateText(next.text, next.caret);
    setMentionIndex(0);
    focusAt(next.caret);
  }

  /** From the agent panel: add "@handle " at the caret unless it's already there. */
  function mentionAgent(agent: Agent) {
    if (conversation.agentId === agent.id || new RegExp(`(?:^|\\s)@${agent.handle}(?![\\w-])`, "i").test(text)) {
      focusAt(caret);
      return;
    }
    const before = text.slice(0, caret);
    const spacer = before && !/\s$/.test(before) ? " " : "";
    const token = `@${agent.handle} `;
    updateText(`${before}${spacer}${token}${text.slice(caret)}`, before.length + spacer.length + token.length);
    focusAt(before.length + spacer.length + token.length);
  }

  function submit() {
    if (command) {
      openAgentPanel(conversationId, command[1]?.trim());
      updateText("", 0);
      return;
    }
    if (!canSend) {
      if (uploading && hasContent) toast("Still uploading. It’ll be ready in a moment.");
      return;
    }
    void actions.send({
      body: text.trim(),
      attachments: readyAttachments,
      replyTo,
      agentModel: woken.length > 0 && replyModel !== AUTO_MODEL ? replyModel : null,
    });
    setText("");
    setCaret(0);
    setDismissedMentionAt(null);
    setReplyModel(AUTO_MODEL);
    store.getState().setDraft(conversationId, "");
    store.getState().setReplyTarget(conversationId, undefined);
    uploads.clear();
    onStopTyping();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.nativeEvent.isComposing) return;

    if (mentionOpen) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const step = event.key === "ArrowDown" ? 1 : -1;
        setMentionIndex((activeMention + step + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        pickMention(suggestions[activeMention]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissedMentionAt(mention?.start ?? null);
        return;
      }
    }

    if (event.key === "Enter") {
      const send = preferences.enterToSend ? !event.shiftKey : event.metaKey || event.ctrlKey;
      if (send) {
        event.preventDefault();
        submit();
      }
      return;
    }

    if (event.key === "Escape" && replyToId) {
      event.preventDefault();
      store.getState().setReplyTarget(conversationId, undefined);
      return;
    }

    if (event.key === "ArrowUp" && text.length === 0) {
      const own = [...(store.getState().threads[conversationId]?.messages ?? [])]
        .reverse()
        .find((message) => message.senderId === me.id && message.kind === "text" && !message.deletedAt && message.delivery === "sent" && message.body);
      if (own) {
        event.preventDefault();
        store.getState().setEditingMessage(own.id);
      }
    }
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const files = Array.from(event.clipboardData.files);
    if (files.length > 0) {
      event.preventDefault();
      uploads.addFiles(files);
    }
  }

  const partner = directPartner(conversation, members, me.id);
  const placeholder =
    conversation.kind === "direct"
      ? `Message ${firstNameOf(partner, "them")}`
      : `Message ${conversationTitle(conversation, members, me.id, agents)}`;

  const replyAgent = replyTo?.agentId ? (agents[replyTo.agentId] ?? null) : null;
  const replyAuthor = replyTo?.senderId ? members[replyTo.senderId] : null;
  const replyColor = replyAgent?.color ?? replyAuthor?.color;
  const replyName =
    replyTo?.senderId === me.id ? "yourself" : replyTo?.agentId ? (replyAgent?.name ?? "an agent") : nameOf(replyAuthor);
  const replyText = replyTo ? (replyTo.agentId ? plainText(replyTo.body) : replyTo.body) : "";
  const modelLabel =
    replyModel !== AUTO_MODEL
      ? (findModel(replyModel)?.label ?? replyModel)
      : autoPick
        ? autoPick.mode === "auto"
          ? `Auto · ${autoPick.model.label}`
          : autoPick.model.label
        : "Auto";

  return (
    <div className="shrink-0 px-3 pb-3 pt-1 sm:px-6 sm:pb-5">
      <div className="relative mx-auto w-full max-w-[880px]">
        {panelOpen ? (
          <AgentPanel
            key={agentPanel?.prompt ?? "panel"}
            conversation={conversation}
            initialPrompt={agentPanel?.prompt}
            onClose={closeAgentPanel}
            onMention={mentionAgent}
          />
        ) : mentionOpen ? (
          <MentionMenu agents={suggestions} activeIndex={activeMention} onPick={pickMention} onHover={setMentionIndex} />
        ) : null}

        <div
          className={cn(
            "overflow-hidden rounded-[24px] border bg-surface transition-[border-color,box-shadow] duration-150",
            "border-line-2 focus-within:border-ink-4 focus-within:shadow-[0_0_0_4px_color-mix(in_srgb,var(--ink)_5%,transparent)]",
            tooLong && "border-danger",
          )}
        >
          {replyTo ? (
            <div className="flex items-center gap-3 border-b border-line px-4 py-2.5" style={replyColor ? personColorStyle(replyColor) : undefined}>
              <IconReply size={16} className="shrink-0 text-person" />
              <div className="min-w-0 flex-1 text-[13px]">
                <p className="text-ink-3">
                  Replying to <span className="font-semibold text-person-ink">{replyName}</span>
                </p>
                <p className="truncate text-ink-2">{replyText || attachmentSummary(replyTo.attachments.length)}</p>
              </div>
              <button
                type="button"
                onClick={() => store.getState().setReplyTarget(conversationId, undefined)}
                className="flex size-7 items-center justify-center rounded-full text-ink-3 hover:bg-paper hover:text-ink"
                aria-label="Cancel reply"
              >
                <IconClose size={15} />
              </button>
            </div>
          ) : null}

          <UploadTray items={uploads.items} onRemove={uploads.remove} onRetry={uploads.retry} />

          <div className="flex items-end gap-1 p-1.5">
            <IconButton label="Attach files" onClick={() => fileInputRef.current?.click()} className="shrink-0">
              <IconPaperclip />
            </IconButton>
            {aiReady ? (
              <IconButton
                label="Agents"
                data-agent-panel-toggle
                aria-expanded={panelOpen}
                onClick={() => (panelOpen ? closeAgentPanel() : openAgentPanel(conversationId))}
                className={cn("shrink-0", panelOpen && "bg-paper-2 text-ink")}
              >
                <IconSpark />
              </IconButton>
            ) : null}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              className="hidden"
              onChange={(event) => {
                if (event.target.files) uploads.addFiles(event.target.files);
                event.target.value = "";
              }}
            />
            <textarea
              ref={textareaRef}
              rows={1}
              value={text}
              onChange={(event) => {
                updateText(event.target.value, event.target.selectionStart);
                setMentionIndex(0);
              }}
              onSelect={(event) => setCaret(event.currentTarget.selectionStart)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              onBlur={onStopTyping}
              placeholder={placeholder}
              aria-label={placeholder}
              aria-autocomplete={aiReady ? "list" : undefined}
              aria-controls={mentionOpen ? "mention-menu" : undefined}
              aria-activedescendant={mentionOpen ? `mention-${suggestions[activeMention].id}` : undefined}
              className="max-h-[220px] min-h-9 flex-1 resize-none bg-transparent px-1.5 py-[7px] text-[15px] leading-[22px] text-ink outline-none placeholder:text-ink-4"
            />
            <button
              type="button"
              onClick={submit}
              disabled={!canSend && !command}
              style={personColorStyle(me.color)}
              className={cn(
                "flex size-9 shrink-0 items-center justify-center rounded-full transition-[background-color,transform] duration-150",
                canSend || command ? "bg-person text-person-on hover:scale-105 active:scale-95" : "bg-paper-2 text-ink-4",
              )}
              aria-label={command ? "Create an agent" : "Send message"}
            >
              {command ? <IconSpark size={18} strokeWidth={2} /> : <IconArrowUp size={18} strokeWidth={2} />}
            </button>
          </div>
        </div>

        <div className="mt-1.5 hidden h-4 items-center justify-between gap-3 px-3 font-mono text-[10.5px] text-ink-4 sm:flex">
          {command ? (
            <span className="text-ink-3">enter to design an agent{command[1]?.trim() ? " from your description" : ""}</span>
          ) : woken.length > 0 ? (
            <span className="flex min-w-0 items-center gap-1.5 text-ink-3">
              <AgentAvatar agent={woken[0]} size="xs" className="size-4 rounded-[5px]" />
              <span className="truncate">{joinNames(woken.map((agent) => agent.name), 3)} will reply</span>
              <span aria-hidden="true">·</span>
              <ModelMenu
                value={replyModel}
                onChange={setReplyModel}
                available={available}
                autoHint={autoPick?.mode === "auto" ? autoPick.model.label : null}
                label={modelLabel}
                className="text-ink-3"
              />
              {balance !== null && balance <= 0 ? <span className="shrink-0 text-danger">· out of AI credits</span> : null}
            </span>
          ) : (
            <span>
              {preferences.enterToSend ? "enter to send · shift + enter for a new line" : "ctrl + enter to send"}
              {aiReady ? " · /agent to create an agent" : ""}
            </span>
          )}
          {text.length > MAX_MESSAGE_LENGTH - 400 ? (
            <span className={cn("shrink-0", tooLong && "text-danger")}>
              {text.length} / {MAX_MESSAGE_LENGTH}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
