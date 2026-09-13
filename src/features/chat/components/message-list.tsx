"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { IconArrowDown } from "@/components/ui/icons";
import { LocalTime } from "@/components/ui/local-time";
import { Spinner } from "@/components/ui/spinner";
import { AgentIntro } from "@/features/ai/components/agent-intro";
import { ConversationAvatar } from "@/features/workspace/components/conversation-avatar";
import { useWorkspace, useWorkspaceStore } from "@/features/workspace/store/workspace-provider";
import { cn, nameOf } from "@/lib/utils";
import type { Conversation, Message } from "@/types/domain";

import { useMarkRead } from "../hooks/use-mark-read";
import { useMessageActions } from "../hooks/use-message-actions";
import { useThread } from "../hooks/use-thread";
import { conversationTitle, directPartner, systemMessageText } from "../lib/conversation-meta";
import { buildTimeline } from "../lib/timeline";
import { MessageItem } from "./message-item";
import { ReadReceipt } from "./read-receipt";
import { TypingIndicator } from "./typing-indicator";

const BOTTOM_THRESHOLD_PX = 96;
const LOAD_OLDER_THRESHOLD_PX = 480;

interface MessageListProps {
  conversation: Conversation;
  focusMessageId?: string;
}

export function MessageList({ conversation, focusMessageId }: MessageListProps) {
  const conversationId = conversation.id;
  const store = useWorkspaceStore();
  const { thread, loadOlder, retry } = useThread(conversationId);
  const me = useWorkspace((state) => state.me);
  const members = useWorkspace((state) => state.members);
  const agents = useWorkspace((state) => state.agents);
  const actions = useMessageActions(conversationId);
  const markRead = useMarkRead(conversationId);

  // Captured once: where "new" started when this chat was opened.
  const [unreadAfter] = useState(() => (conversation.unreadCount > 0 ? conversation.lastReadAt : null));
  const [atBottom, setAtBottom] = useState(true);
  const [newBelow, setNewBelow] = useState(0);
  const [highlightId, setHighlightId] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const initialScrollDone = useRef(false);
  const edges = useRef({ first: "", last: "", count: 0 });
  const prependAnchor = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);

  const messages = useMemo(() => thread?.messages ?? [], [thread?.messages]);
  const ready = thread?.status === "ready";
  const rows = useMemo(() => buildTimeline(messages, unreadAfter, me.id), [messages, unreadAfter, me.id]);
  const latestConfirmed = useMemo(() => [...messages].reverse().find((message) => message.delivery === "sent"), [messages]);
  const lastMessage = messages[messages.length - 1];

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const element = scrollRef.current;
    if (element) element.scrollTo({ top: element.scrollHeight, behavior });
  }, []);

  const jumpTo = useCallback((messageId: string) => {
    const target = scrollRef.current?.querySelector<HTMLElement>(`[data-message-id="${messageId}"]`);
    if (!target) return;
    target.scrollIntoView({ block: "center", behavior: "smooth" });
    setHighlightId(null);
    requestAnimationFrame(() => setHighlightId(messageId));
  }, []);

  const requestOlder = useCallback(() => {
    const element = scrollRef.current;
    const current = store.getState().threads[conversationId];
    if (!element || !current?.hasMore || current.loadingOlder) return;
    prependAnchor.current = { scrollHeight: element.scrollHeight, scrollTop: element.scrollTop };
    void loadOlder();
  }, [conversationId, loadOlder, store]);

  // Keep the reader's place through prepends, follow new messages when at the bottom.
  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element || !ready) return;

    const first = messages[0]?.id ?? "";
    const last = messages[messages.length - 1]?.id ?? "";
    const previous = edges.current;
    edges.current = { first, last, count: messages.length };

    if (!initialScrollDone.current) {
      initialScrollDone.current = true;
      const focus = focusMessageId ? element.querySelector<HTMLElement>(`[data-message-id="${focusMessageId}"]`) : null;
      const marker = focus ?? element.querySelector<HTMLElement>("[data-unread-marker]");
      if (marker) {
        marker.scrollIntoView({ block: "center" });
        if (focus) setHighlightId(focusMessageId ?? null);
      } else {
        element.scrollTop = element.scrollHeight;
      }
      return;
    }

    if (prependAnchor.current && first !== previous.first) {
      const anchor = prependAnchor.current;
      prependAnchor.current = null;
      element.scrollTop = element.scrollHeight - anchor.scrollHeight + anchor.scrollTop;
      return;
    }

    if (last !== previous.last) {
      const newest = messages[messages.length - 1];
      if (atBottomRef.current || newest?.senderId === me.id) {
        element.scrollTop = element.scrollHeight;
      } else {
        setNewBelow((count) => count + Math.max(1, messages.length - previous.count));
      }
    }
  }, [messages, ready, focusMessageId, me.id]);

  // Images and link previews change height after render; stay pinned if pinned.
  useEffect(() => {
    const element = scrollRef.current;
    const content = contentRef.current;
    if (!element || !content || !ready) return;
    const observer = new ResizeObserver(() => {
      if (atBottomRef.current) element.scrollTop = element.scrollHeight;
    });
    observer.observe(content);
    return () => observer.disconnect();
  }, [ready]);

  // Reading at the bottom of a visible chat counts as read.
  useEffect(() => {
    if (!latestConfirmed || !atBottom) return;
    const attempt = () => {
      if (document.visibilityState === "visible") markRead(latestConfirmed.createdAt);
    };
    attempt();
    document.addEventListener("visibilitychange", attempt);
    window.addEventListener("focus", attempt);
    return () => {
      document.removeEventListener("visibilitychange", attempt);
      window.removeEventListener("focus", attempt);
    };
  }, [latestConfirmed, atBottom, markRead]);

  function handleScroll() {
    const element = scrollRef.current;
    if (!element) return;
    const bottom = element.scrollHeight - element.scrollTop - element.clientHeight < BOTTOM_THRESHOLD_PX;
    atBottomRef.current = bottom;
    if (bottom !== atBottom) setAtBottom(bottom);
    if (bottom && newBelow > 0) setNewBelow(0);
    if (element.scrollTop < LOAD_OLDER_THRESHOLD_PX) requestOlder();
  }

  const onReply = useCallback(
    (message: Message) => store.getState().setReplyTarget(conversationId, message.id),
    [conversationId, store],
  );

  if (!thread || (thread.status === "loading" && messages.length === 0)) {
    return <ThreadSkeleton />;
  }

  if (thread.status === "error" && messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="font-display text-xl font-semibold">Messages didn’t load.</p>
        <p className="text-sm text-ink-3">Check your connection and try again.</p>
        <Button variant="secondary" onClick={() => void retry()}>
          Try again
        </Button>
      </div>
    );
  }

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain [overflow-anchor:none]"
        role="log"
        aria-label={`Messages with ${conversationTitle(conversation, members, me.id, agents)}`}
        aria-live="polite"
        aria-relevant="additions"
      >
        <div ref={contentRef} className="mx-auto flex w-full max-w-[880px] flex-col px-3 pb-4 pt-6 sm:px-6">
          {thread.hasMore ? (
            <div className="flex h-12 items-center justify-center">
              {thread.loadingOlder ? (
                <Spinner size={16} className="text-ink-3" />
              ) : (
                <Button variant="ghost" size="sm" onClick={requestOlder}>
                  Load earlier messages
                </Button>
              )}
            </div>
          ) : conversation.agentId ? (
            <AgentIntro conversation={conversation} />
          ) : (
            <ConversationIntro conversation={conversation} />
          )}

          {rows.map((row) => {
            if (row.type === "day") {
              return (
                <div key={row.key} className="sticky top-2 z-[1] my-5 flex justify-center" role="separator">
                  <LocalTime
                    iso={row.iso}
                    format="day"
                    className="rounded-full border border-line bg-paper px-3 py-1 font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-3"
                  />
                </div>
              );
            }
            if (row.type === "unread") {
              return (
                <div key={row.key} data-unread-marker className="my-4 flex items-center gap-3" role="separator">
                  <span className="h-px flex-1 bg-accent" />
                  <span className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em] text-accent">New</span>
                  <span className="h-px flex-1 bg-accent" />
                </div>
              );
            }
            if (row.type === "system") {
              return (
                <p key={row.key} className="my-3 text-center text-[12.5px] text-ink-3">
                  {systemMessageText(row.message.meta, row.message.senderId, members, me.id)}
                  <span className="text-ink-4">
                    {" "}
                    · <LocalTime iso={row.message.createdAt} />
                  </span>
                </p>
              );
            }
            const { message } = row;
            return (
              <MessageItem
                key={row.key}
                message={message}
                sender={message.senderId ? (members[message.senderId] ?? null) : null}
                agent={message.agentId ? (agents[message.agentId] ?? null) : null}
                mine={message.senderId === me.id}
                myColor={me.color}
                startsGroup={row.startsGroup}
                endsGroup={row.endsGroup}
                showName={conversation.kind === "group"}
                highlighted={highlightId === message.id}
                actions={actions}
                onReply={onReply}
                onJumpTo={jumpTo}
              />
            );
          })}

          {lastMessage && lastMessage.senderId === me.id && lastMessage.kind === "text" && lastMessage.delivery === "sent" ? (
            <ReadReceipt conversation={conversation} message={lastMessage} />
          ) : null}
          <TypingIndicator conversationId={conversationId} />
        </div>
      </div>

      {!atBottom ? (
        <button
          type="button"
          onClick={() => {
            setNewBelow(0);
            scrollToBottom("smooth");
          }}
          className={cn(
            "absolute bottom-3 left-1/2 flex h-9 -translate-x-1/2 animate-rise items-center gap-2 rounded-full px-4 text-[13px] font-medium shadow-pop",
            newBelow > 0 ? "bg-accent text-accent-ink" : "border border-line bg-surface text-ink-2",
          )}
        >
          <IconArrowDown size={15} />
          {newBelow > 0 ? `${newBelow} new ${newBelow === 1 ? "message" : "messages"}` : "Latest"}
        </button>
      ) : null}
    </div>
  );
}

function ConversationIntro({ conversation }: { conversation: Conversation }) {
  const members = useWorkspace((state) => state.members);
  const meId = useWorkspace((state) => state.me.id);
  const partner = directPartner(conversation, members, meId);
  const title = conversationTitle(conversation, members, meId);

  return (
    <div className="mb-6 mt-4 flex flex-col items-start gap-4 px-1 [--avatar-ring:var(--paper)]">
      {conversation.kind === "direct" ? <Avatar person={partner} size="xl" /> : <ConversationAvatar conversation={conversation} size="xl" />}
      <div>
        <h2 className="font-display text-[26px] font-semibold leading-tight tracking-[-0.02em]">{title}</h2>
        <p className="mt-1 max-w-[460px] text-[14px] text-ink-3">
          {conversation.kind === "direct"
            ? `This is the start of your conversation with ${nameOf(partner)}. Only the two of you can see it.`
            : `This group has ${conversation.participants.length} people. Everyone here sees the whole history.`}
        </p>
      </div>
    </div>
  );
}

function ThreadSkeleton() {
  const shapes = [
    { mine: false, width: "w-56" },
    { mine: false, width: "w-72" },
    { mine: true, width: "w-48" },
    { mine: false, width: "w-40" },
    { mine: true, width: "w-64" },
    { mine: true, width: "w-32" },
  ];
  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-1 flex-col justify-end gap-2.5 px-4 pb-6 sm:px-7" aria-label="Loading messages">
      {shapes.map((shape, index) => (
        <div key={index} className={cn("flex items-end gap-3", shape.mine && "flex-row-reverse")}>
          {!shape.mine ? <span className="size-9 animate-pulse rounded-full bg-paper-3" /> : null}
          <span className={cn("h-10 animate-pulse rounded-[20px] bg-paper-3", shape.width)} style={{ animationDelay: `${index * 80}ms` }} />
        </div>
      ))}
    </div>
  );
}
