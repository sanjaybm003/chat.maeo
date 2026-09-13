"use client";

import { useRouter } from "next/navigation";
import { Dialog as DialogPrimitive } from "radix-ui";
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

import { Avatar } from "@/components/ui/avatar";
import {
  IconArrowRight,
  IconCompose,
  IconMoon,
  IconSearch,
  IconSliders,
  IconSun,
  IconUserPlus,
  IconUsers,
} from "@/components/ui/icons";
import { Kbd } from "@/components/ui/kbd";
import { LocalTime } from "@/components/ui/local-time";
import { Spinner } from "@/components/ui/spinner";
import { conversationTitle } from "@/features/chat/lib/conversation-meta";
import { readPreferences, resolveTheme, usePreferences } from "@/lib/preferences";
import { rankItems } from "@/lib/search/fuzzy";
import { routes } from "@/lib/routes";
import { cn, nameOf } from "@/lib/utils";

import { searchMessages, type MessageSearchResult } from "../api/messages";
import { useMessagePerson, useOpenConversation } from "../hooks/use-open-conversation";
import { memberSearchFields } from "../lib/search-fields";
import { useWorkspace } from "../store/workspace-provider";
import { ConversationAvatar } from "./conversation-avatar";

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[#191713]/45 data-[state=open]:animate-fade-in" />
        <DialogPrimitive.Content
          className="fixed left-1/2 top-[10vh] z-50 flex max-h-[min(72vh,620px)] w-[calc(100vw-1.5rem)] max-w-[640px] -translate-x-1/2 flex-col overflow-hidden rounded-[24px] border border-line bg-surface shadow-pop outline-none data-[state=open]:animate-pop-in"
          aria-describedby={undefined}
        >
          <DialogPrimitive.Title className="sr-only">Search maeosan</DialogPrimitive.Title>
          {open ? <PaletteBody onClose={() => onOpenChange(false)} /> : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

interface PaletteItem {
  key: string;
  section: string;
  label: ReactNode;
  hint?: ReactNode;
  leading: ReactNode;
  run: () => void;
}

function useMessageSearch(workspaceId: string, query: string) {
  const [result, setResult] = useState<{ query: string; items: MessageSearchResult[] } | null>(null);
  const trimmed = query.trim();
  const searchable = trimmed.length >= 2;

  useEffect(() => {
    if (!searchable) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const items = await searchMessages(workspaceId, trimmed);
        if (!cancelled) setResult({ query: trimmed, items });
      } catch {
        if (!cancelled) setResult({ query: trimmed, items: [] });
      }
    }, 220);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [workspaceId, trimmed, searchable]);

  if (!searchable) return { items: [], loading: false };
  return { items: result?.query === trimmed ? result.items : [], loading: result?.query !== trimmed };
}

function Highlight({ text, query }: { text: string; query: string }) {
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (!query || index === -1) return <>{text}</>;
  const start = Math.max(0, index - 40);
  return (
    <>
      {start > 0 ? "…" : ""}
      {text.slice(start, index)}
      <mark className="rounded-[4px] bg-saffron-tint px-0.5 text-ink">{text.slice(index, index + query.length)}</mark>
      {text.slice(index + query.length, index + query.length + 120)}
    </>
  );
}

function PaletteBody({ onClose }: { onClose: () => void }) {
  const router = useRouter();
  const members = useWorkspace((state) => state.members);
  const conversations = useWorkspace((state) => state.conversations);
  const me = useWorkspace((state) => state.me);
  const workspace = useWorkspace((state) => state.workspace);
  const online = useWorkspace((state) => state.online);
  const openDialog = useWorkspace((state) => state.openDialog);
  const openConversation = useOpenConversation();
  const messagePerson = useMessagePerson();
  const [, updatePreferences] = usePreferences();

  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const search = useMessageSearch(workspace.id, query);
  const q = query.trim().toLowerCase();

  const items = useMemo<PaletteItem[]>(() => {
    const go = (fn: () => void) => () => {
      onClose();
      fn();
    };

    const people: PaletteItem[] = (
      q ? rankItems(Object.values(members).filter((member) => member.id !== me.id), q, memberSearchFields, 5) : []
    ).map((member) => ({
        key: `person-${member.id}`,
        section: "People",
        label: nameOf(member),
        hint: member.title || member.email,
        leading: <Avatar person={member} size="sm" online={Boolean(online[member.id])} />,
        run: go(() => void messagePerson(member.id)),
      }));

    const recentChats = Object.values(conversations)
      .map((conversation) => ({ conversation, title: conversationTitle(conversation, members, me.id) }))
      .sort(
        (a, b) =>
          (Date.parse(b.conversation.lastMessageAt ?? b.conversation.createdAt) || 0) -
          (Date.parse(a.conversation.lastMessageAt ?? a.conversation.createdAt) || 0),
      );

    const chats: PaletteItem[] = (
      q ? rankItems(recentChats, q, ({ title }) => [[title, 1] as const], 5) : recentChats.slice(0, 4)
    ).map(({ conversation, title }) => ({
        key: `chat-${conversation.id}`,
        section: q ? "Chats" : "Recent",
        label: title,
        hint: conversation.kind === "group" ? `${conversation.participants.length} people` : undefined,
        leading: <ConversationAvatar conversation={conversation} size="sm" />,
        run: go(() => void openConversation(conversation.id)),
      }));

    const messages: PaletteItem[] = search.items.map((result) => {
      const conversation = conversations[result.conversationId];
      const sender = result.senderId ? members[result.senderId] : null;
      return {
        key: `message-${result.id}`,
        section: "Messages",
        label: (
          <span className="block truncate font-normal text-ink-2">
            <Highlight text={result.body.replace(/\s+/g, " ")} query={query.trim()} />
          </span>
        ),
        hint: (
          <>
            {nameOf(sender)}
            {conversation ? ` in ${conversationTitle(conversation, members, me.id)}` : ""} ·{" "}
            <LocalTime iso={result.createdAt} format="list" />
          </>
        ),
        leading: <Avatar person={sender} size="sm" />,
        run: go(() => void openConversation(result.conversationId, result.id)),
      };
    });

    const actions: PaletteItem[] = [
      {
        key: "action-new-chat",
        section: "Actions",
        label: "Start a new chat",
        leading: <IconCompose size={17} />,
        run: () => openDialog({ name: "new-chat" }),
      },
      {
        key: "action-invite",
        section: "Actions",
        label: "Invite people",
        leading: <IconUserPlus size={17} />,
        run: () => openDialog({ name: "invite" }),
      },
      {
        key: "action-contacts",
        section: "Actions",
        label: "Open contacts",
        leading: <IconUsers size={17} />,
        run: go(() => router.push(routes.contacts(workspace.slug))),
      },
      {
        key: "action-settings",
        section: "Actions",
        label: "Settings",
        leading: <IconSliders size={17} />,
        run: go(() => router.push(routes.settings(workspace.slug))),
      },
      {
        key: "action-theme",
        section: "Actions",
        label: "Switch light / dark",
        leading: <ThemeIcon />,
        run: go(() => updatePreferences({ theme: resolveTheme(readPreferences().theme) === "dark" ? "light" : "dark" })),
      },
    ].filter((item) => (q ? String(item.label).toLowerCase().includes(q) : true));

    return [...chats, ...people, ...messages, ...actions];
  }, [members, conversations, me.id, online, q, query, search.items, workspace.slug, onClose, openConversation, messagePerson, openDialog, router, updatePreferences]);

  const activeIndex = Math.min(highlight, Math.max(items.length - 1, 0));

  function move(next: number) {
    setHighlight(next);
    listRef.current?.querySelector<HTMLElement>(`[data-index="${next}"]`)?.scrollIntoView({ block: "nearest" });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(Math.min(activeIndex + 1, items.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      move(Math.max(activeIndex - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      items[activeIndex]?.run();
    }
  }

  let lastSection = "";

  return (
    <>
      <div className="flex items-center gap-3 border-b border-line px-5">
        <IconSearch size={19} className="shrink-0 text-ink-3" />
        <input
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setHighlight(0);
          }}
          onKeyDown={handleKeyDown}
          placeholder="Search people, chats and messages"
          className="h-16 min-w-0 flex-1 bg-transparent text-[17px] text-ink outline-none placeholder:text-ink-4"
          role="combobox"
          aria-expanded="true"
          aria-controls="palette-results"
          aria-activedescendant={items[activeIndex]?.key}
        />
        {search.loading ? <Spinner size={16} className="text-ink-3" /> : <Kbd>esc</Kbd>}
      </div>

      <div ref={listRef} id="palette-results" role="listbox" className="min-h-0 flex-1 overflow-y-auto p-2 [--avatar-ring:var(--surface)]">
        {items.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-ink-3">
            {search.loading ? "Searching…" : `Nothing found for “${query.trim()}”.`}
          </p>
        ) : (
          items.map((item, index) => {
            const header = item.section !== lastSection ? item.section : null;
            lastSection = item.section;
            return (
              <div key={item.key}>
                {header ? (
                  <p className="px-3 pb-1.5 pt-3 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-4">{header}</p>
                ) : null}
                <button
                  id={item.key}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  data-index={index}
                  onClick={item.run}
                  onMouseMove={() => activeIndex !== index && setHighlight(index)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left",
                    index === activeIndex && "bg-paper [--avatar-ring:var(--paper)]",
                  )}
                >
                  <span className="flex size-7 shrink-0 items-center justify-center text-ink-3">{item.leading}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14.5px] font-medium text-ink">{item.label}</span>
                    {item.hint ? <span className="block truncate text-[12.5px] text-ink-3">{item.hint}</span> : null}
                  </span>
                  {index === activeIndex ? <IconArrowRight size={16} className="shrink-0 text-ink-3" /> : null}
                </button>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}

function ThemeIcon() {
  const [preferences] = usePreferences();
  return preferences.theme === "dark" ? <IconSun size={17} /> : <IconMoon size={17} />;
}
