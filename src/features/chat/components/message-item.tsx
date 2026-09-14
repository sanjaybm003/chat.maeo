"use client";

import { memo, useState, type ComponentProps, type KeyboardEvent } from "react";
import { toast } from "sonner";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { IconCopy, IconMore, IconPencil, IconReply, IconSmile, IconSpark, IconTasks, IconTrash } from "@/components/ui/icons";
import { LocalTime } from "@/components/ui/local-time";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Tooltip } from "@/components/ui/tooltip";
import { AgentAvatar, AgentTag } from "@/features/ai/components/agent-avatar";
import { AgentReplyBody, AgentReplyFooter } from "@/features/ai/components/agent-reply";
import { useSaveAsExample } from "@/features/ai/hooks/use-save-example";
import { plainText } from "@/features/ai/lib/rich-text";
import { taskDraftFromMessage } from "@/features/tasks/lib/task-drafts";
import { isRunLive } from "@/features/workspace/store/helpers";
import { useWorkspace } from "@/features/workspace/store/workspace-provider";
import { personColorStyle } from "@/lib/colors";
import { MAX_MESSAGE_LENGTH } from "@/lib/constants";
import { cn, joinNames, nameOf } from "@/lib/utils";
import type { Agent, Member, Message, PersonColor, ReplyPreview } from "@/types/domain";

import type { MessageActions } from "../hooks/use-message-actions";
import { attachmentSummary } from "../lib/conversation-meta";
import { formatMessageBody, isEmojiOnly } from "../lib/format-message";
import { groupReactions } from "../lib/timeline";
import { AttachmentGrid } from "./attachments";
import { ReactionPicker } from "./reaction-picker";

interface MessageItemProps {
  message: Message;
  sender: Member | null;
  /** The agent that wrote this message, when an agent did. */
  agent: Agent | null;
  mine: boolean;
  myColor: PersonColor;
  startsGroup: boolean;
  endsGroup: boolean;
  showName: boolean;
  highlighted: boolean;
  actions: MessageActions;
  onReply: (message: Message) => void;
  onJumpTo: (messageId: string) => void;
}

export const MessageItem = memo(function MessageItem({
  message,
  sender,
  agent,
  mine,
  myColor,
  startsGroup,
  endsGroup,
  showName,
  highlighted,
  actions,
  onReply,
  onJumpTo,
}: MessageItemProps) {
  const editing = useWorkspace((state) => state.editingMessageId === message.id);
  const setEditing = useWorkspace((state) => state.setEditingMessage);
  const tasksReady = useWorkspace((state) => state.tasksReady);
  const openDialog = useWorkspace((state) => state.openDialog);
  const canTuneAgent = useWorkspace(
    (state) => Boolean(agent && !agent.archivedAt && (agent.createdBy === state.me.id || state.myRole !== "member")),
  );
  const saveAsExample = useSaveAsExample();
  const [toolsOpen, setToolsOpen] = useState(false);
  const [tapped, setTapped] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const deleted = Boolean(message.deletedAt);
  const isAgent = Boolean(message.agentId);
  const live = isRunLive(message);
  const emojiOnly =
    !deleted && !isAgent && message.attachments.length === 0 && !message.replyTo && isEmojiOnly(message.body);
  const hasText = !deleted && message.body.length > 0;
  const interactive = !deleted && message.delivery === "sent" && !editing && !live;

  function handleBubbleClick() {
    if (window.matchMedia("(hover: none)").matches) setTapped((value) => !value);
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(message.body);
      toast.success("Copied.");
    } catch {
      toast.error("Couldn't copy the message.");
    }
  }

  return (
    <div
      data-message-id={message.id}
      className={cn(
        "group/message relative flex gap-2.5 rounded-2xl px-1 sm:gap-3",
        startsGroup ? "mt-4" : "mt-[3px]",
        mine && "flex-row-reverse",
        highlighted && "flash-highlight",
      )}
    >
      {!mine ? (
        <div className="w-9 shrink-0 pt-0.5">
          {startsGroup ? (
            isAgent ? <AgentAvatar agent={agent} size="md" working={live} /> : <Avatar person={sender} size="md" />
          ) : null}
        </div>
      ) : null}

      <div
        className={cn(
          "flex min-w-0 flex-col",
          isAgent ? "max-w-[min(88%,720px)]" : "max-w-[min(80%,640px)]",
          mine ? "items-end" : "items-start",
        )}
      >
        {startsGroup ? (
          <div className={cn("mb-1 flex items-baseline gap-2 px-1", mine && "flex-row-reverse")}>
            {isAgent ? (
              <span
                className="flex items-center gap-1.5 self-center text-[13px] font-semibold text-person-ink"
                style={agent ? personColorStyle(agent.color) : undefined}
              >
                {agent?.name ?? "Removed agent"}
                <AgentTag />
              </span>
            ) : showName && !mine ? (
              <span className="text-[13px] font-semibold text-person-ink" style={sender ? personColorStyle(sender.color) : undefined}>
                {nameOf(sender)}
              </span>
            ) : null}
            <LocalTime iso={message.createdAt} withTitle className="font-mono text-[10.5px] text-ink-4" />
          </div>
        ) : null}

        <div className={cn("relative flex max-w-full items-center gap-2", mine && "flex-row-reverse")}>
          {editing ? (
            <EditBox message={message} actions={actions} onClose={() => setEditing(null)} color={myColor} />
          ) : (
            <div
              onClick={handleBubbleClick}
              style={mine ? personColorStyle(myColor) : undefined}
              className={cn(
                "relative min-w-0 max-w-full break-words text-[15px] leading-[1.45] text-ink",
                deleted
                  ? "rounded-[18px] border border-dashed border-line-2 px-3.5 py-2 text-[14px] italic text-ink-3"
                  : emojiOnly
                    ? "px-1 text-[42px] leading-[1.1]"
                    : mine
                      ? "rounded-[20px] bg-person-tint"
                      : "rounded-[20px] border border-line bg-surface",
                !deleted && !emojiOnly && endsGroup && (mine ? "rounded-br-[6px]" : "rounded-bl-[6px]"),
                message.delivery === "sending" && "opacity-65",
                message.delivery === "failed" && "outline outline-1 outline-danger",
              )}
            >
              {deleted ? (
                "This message was deleted"
              ) : (
                <>
                  {message.replyTo ? <ReplyQuote reply={message.replyTo} onJumpTo={onJumpTo} /> : null}
                  {isAgent ? <AgentReplyBody message={message} /> : null}
                  {!isAgent && message.attachments.length > 0 ? <AttachmentGrid attachments={message.attachments} /> : null}
                  {!isAgent && hasText ? (
                    <div className={cn("whitespace-pre-wrap", !emojiOnly && "px-3.5 py-2")}>
                      {emojiOnly ? message.body : formatMessageBody(message.body)}
                      {message.editedAt && !emojiOnly ? (
                        <span className="ml-1.5 select-none align-baseline font-mono text-[10.5px] text-ink-4">edited</span>
                      ) : null}
                    </div>
                  ) : null}
                </>
              )}
            </div>
          )}

          {interactive ? (
            <div
              data-open={toolsOpen || tapped || undefined}
              className={cn(
                "flex shrink-0 items-center gap-0.5 rounded-full border border-line bg-surface p-0.5 opacity-0 shadow-pop transition-opacity duration-150",
                "pointer-events-none group-hover/message:pointer-events-auto group-hover/message:opacity-100 focus-within:pointer-events-auto focus-within:opacity-100",
                "data-[open]:pointer-events-auto data-[open]:opacity-100",
              )}
            >
              <ReactionPicker onPick={(emoji) => void actions.toggleReaction(message, emoji)} onOpenChange={setToolsOpen}>
                <ToolButton label="React">
                  <IconSmile size={16} />
                </ToolButton>
              </ReactionPicker>
              <ToolButton label="Reply" onClick={() => onReply(message)}>
                <IconReply size={16} />
              </ToolButton>
              <Menu onOpenChange={setToolsOpen}>
                <MenuTrigger asChild>
                  <button
                    type="button"
                    className="flex size-7 items-center justify-center rounded-full text-ink-3 hover:bg-paper hover:text-ink"
                    aria-label="More actions"
                  >
                    <IconMore size={16} />
                  </button>
                </MenuTrigger>
                <MenuContent align={mine ? "end" : "start"} className="min-w-[180px]">
                  <MenuItem icon={<IconReply size={16} />} onSelect={() => onReply(message)}>
                    Reply
                  </MenuItem>
                  {hasText ? (
                    <MenuItem icon={<IconCopy size={16} />} onSelect={() => void copyText()}>
                      Copy text
                    </MenuItem>
                  ) : null}
                  {hasText && tasksReady ? (
                    <MenuItem icon={<IconTasks size={16} />} onSelect={() => openDialog({ name: "task", draft: taskDraftFromMessage(message) })}>
                      Make a task
                    </MenuItem>
                  ) : null}
                  {isAgent && hasText && canTuneAgent && message.run?.status === "done" ? (
                    <MenuItem icon={<IconSpark size={16} />} onSelect={() => void saveAsExample(message)}>
                      Save as an example
                    </MenuItem>
                  ) : null}
                  {mine ? (
                    <>
                      <MenuSeparator />
                      <MenuItem icon={<IconPencil size={16} />} onSelect={() => setEditing(message.id)} shortcut="↑">
                        Edit
                      </MenuItem>
                      <MenuItem tone="danger" icon={<IconTrash size={16} />} onSelect={() => setConfirmDelete(true)}>
                        Delete
                      </MenuItem>
                    </>
                  ) : null}
                </MenuContent>
              </Menu>
            </div>
          ) : null}
        </div>

        {isAgent && !deleted ? <AgentReplyFooter message={message} /> : null}

        {message.reactions.length > 0 && !deleted ? (
          <ReactionPills message={message} mine={mine} myColor={myColor} actions={actions} />
        ) : null}

        {message.delivery === "failed" ? (
          <p className="mt-1 flex items-center gap-1.5 px-1 text-[12.5px] text-danger">
            Not sent
            <span aria-hidden="true">·</span>
            <button type="button" className="font-medium underline-offset-2 hover:underline" onClick={() => void actions.retry(message)}>
              Retry
            </button>
            <span aria-hidden="true">·</span>
            <button type="button" className="font-medium underline-offset-2 hover:underline" onClick={() => actions.discard(message)}>
              Discard
            </button>
          </p>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this message?"
        description="It will be removed for everyone in the conversation. This can’t be undone."
        confirmLabel="Delete"
        onConfirm={() => actions.remove(message)}
      />
    </div>
  );
});

/** Passes every prop, ref included, to the button so it can be a Radix asChild trigger. */
function ToolButton({ label, className, children, ...props }: ComponentProps<"button"> & { label: string }) {
  return (
    <Tooltip label={label}>
      <button
        type="button"
        aria-label={label}
        className={cn("flex size-7 items-center justify-center rounded-full text-ink-3 hover:bg-paper hover:text-ink", className)}
        {...props}
      >
        {children}
      </button>
    </Tooltip>
  );
}

function ReplyQuote({ reply, onJumpTo }: { reply: ReplyPreview; onJumpTo: (messageId: string) => void }) {
  const author = useWorkspace((state) => (reply.senderId ? state.members[reply.senderId] : null));
  const agent = useWorkspace((state) => (reply.agentId ? state.agents[reply.agentId] : null));
  const color = agent?.color ?? author?.color;
  const body = reply.agentId ? plainText(reply.body) : reply.body;

  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onJumpTo(reply.id);
      }}
      style={color ? personColorStyle(color) : undefined}
      className="mx-1.5 mt-1.5 flex w-[calc(100%-0.75rem)] min-w-[180px] flex-col rounded-[13px] border-l-[3px] border-person bg-[color-mix(in_srgb,var(--ink)_5%,transparent)] px-2.5 py-1.5 text-left"
    >
      <span className="text-[12px] font-semibold text-person-ink">
        {reply.agentId ? (agent?.name ?? "Removed agent") : nameOf(author)}
      </span>
      <span className="line-clamp-2 text-[13px] leading-snug text-ink-2">
        {reply.deletedAt ? "Deleted message" : body || attachmentSummary(reply.attachmentCount)}
      </span>
    </button>
  );
}

function ReactionPills({
  message,
  mine,
  myColor,
  actions,
}: {
  message: Message;
  mine: boolean;
  myColor: PersonColor;
  actions: MessageActions;
}) {
  const members = useWorkspace((state) => state.members);
  const meId = useWorkspace((state) => state.me.id);

  return (
    <div className={cn("mt-1 flex flex-wrap gap-1 px-0.5", mine && "justify-end")}>
      {groupReactions(message.reactions).map(({ emoji, userIds }) => {
        const reacted = userIds.includes(meId);
        const names = userIds.map((id) => (id === meId ? "You" : nameOf(members[id])));
        return (
          <Tooltip key={emoji} label={`${joinNames(names, 6)} reacted ${emoji}`}>
            <button
              type="button"
              onClick={() => void actions.toggleReaction(message, emoji)}
              style={reacted ? personColorStyle(myColor) : undefined}
              aria-pressed={reacted}
              className={cn(
                "inline-flex h-7 items-center gap-1 rounded-full border px-2 text-[14px] transition-colors",
                reacted ? "border-person bg-person-tint" : "border-line bg-surface hover:border-line-2",
              )}
            >
              <span>{emoji}</span>
              <span className="font-mono text-[11px] font-medium text-ink-2">{userIds.length}</span>
            </button>
          </Tooltip>
        );
      })}
    </div>
  );
}

function EditBox({
  message,
  actions,
  onClose,
  color,
}: {
  message: Message;
  actions: MessageActions;
  onClose: () => void;
  color: PersonColor;
}) {
  const [value, setValue] = useState(message.body);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const saved = await actions.edit(message, value);
    setSaving(false);
    if (saved) onClose();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void save();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose();
    }
  }

  return (
    <div className="w-[min(560px,72vw)] rounded-[20px] border border-person bg-surface p-2" style={personColorStyle(color)}>
      <textarea
        autoFocus
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={handleKeyDown}
        onFocus={(event) => event.currentTarget.setSelectionRange(event.currentTarget.value.length, event.currentTarget.value.length)}
        maxLength={MAX_MESSAGE_LENGTH}
        rows={Math.min(8, Math.max(2, value.split("\n").length))}
        className="w-full resize-none bg-transparent px-1.5 py-1 text-[15px] leading-[1.45] text-ink outline-none"
        aria-label="Edit message"
      />
      <div className="flex items-center justify-between gap-2 px-1">
        <span className="font-mono text-[10.5px] text-ink-4">esc to cancel · enter to save</span>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button size="sm" onClick={() => void save()} loading={saving}>
            Save
          </Button>
        </div>
      </div>
    </div>
  );
}
