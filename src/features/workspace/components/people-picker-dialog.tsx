"use client";

import { useRouter } from "next/navigation";
import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import { toast } from "sonner";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogBody, DialogContent, DialogFooter } from "@/components/ui/dialog";
import { IconCheck, IconClose, IconSearch } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { conversationTitle } from "@/features/chat/lib/conversation-meta";
import { getErrorMessage } from "@/lib/errors";
import { routes } from "@/lib/routes";
import { rankItems } from "@/lib/search/fuzzy";
import { cn, firstNameOf, nameOf } from "@/lib/utils";

import { addParticipants, createGroupConversation, fetchConversation, openDirectConversation } from "../api/conversations";
import { memberSearchFields } from "../lib/search-fields";
import { useWorkspace, useWorkspaceStore } from "../store/workspace-provider";

interface PeoplePickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, adds people to this conversation instead of starting a new one. */
  conversationId?: string;
}

export function PeoplePickerDialog({ open, onOpenChange, conversationId }: PeoplePickerDialogProps) {
  const conversation = useWorkspace((state) => (conversationId ? state.conversations[conversationId] : undefined));
  const members = useWorkspace((state) => state.members);
  const meId = useWorkspace((state) => state.me.id);

  const title = conversation
    ? conversation.kind === "direct"
      ? "Start a group"
      : `Add people to ${conversationTitle(conversation, members, meId)}`
    : "New chat";
  const description = conversation
    ? conversation.kind === "direct"
      ? "Your 1:1 stays private. We’ll start a new group with everyone."
      : "They’ll see the whole conversation history."
    : "Pick one person for a private chat, or a few for a group.";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={title} description={description} width="md">
        {open ? <PickerBody conversationId={conversationId} onDone={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

function PickerBody({ conversationId, onDone }: { conversationId?: string; onDone: () => void }) {
  const store = useWorkspaceStore();
  const router = useRouter();
  const members = useWorkspace((state) => state.members);
  const online = useWorkspace((state) => state.online);
  const meId = useWorkspace((state) => state.me.id);
  const workspace = useWorkspace((state) => state.workspace);
  const conversation = useWorkspace((state) => (conversationId ? state.conversations[conversationId] : undefined));
  const openDialog = useWorkspace((state) => state.openDialog);

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [groupName, setGroupName] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [pending, setPending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const candidates = useMemo(() => {
    const excluded = new Set(conversation ? conversation.participants.map((item) => item.userId) : [meId]);
    return Object.values(members)
      .filter((member) => !excluded.has(member.id))
      .sort((a, b) => Number(Boolean(online[b.id])) - Number(Boolean(online[a.id])) || nameOf(a).localeCompare(nameOf(b)));
  }, [members, online, conversation, meId]);

  const filtered = useMemo(() => rankItems(candidates, query, memberSearchFields), [candidates, query]);
  const isNewGroup = !conversation && selected.length > 1;
  const activeIndex = Math.min(highlight, Math.max(filtered.length - 1, 0));

  function toggle(userId: string) {
    setSelected((current) => (current.includes(userId) ? current.filter((id) => id !== userId) : [...current, userId]));
  }

  function moveHighlight(next: number) {
    setHighlight(next);
    listRef.current?.querySelector<HTMLElement>(`[data-index="${next}"]`)?.scrollIntoView({ block: "nearest" });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveHighlight(Math.min(activeIndex + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      moveHighlight(Math.max(activeIndex - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if ((event.metaKey || event.ctrlKey) && selected.length > 0) {
        void submit();
      } else if (filtered[activeIndex]) {
        toggle(filtered[activeIndex].id);
        setQuery("");
      }
    } else if (event.key === "Backspace" && !query && selected.length > 0) {
      setSelected((current) => current.slice(0, -1));
    }
  }

  async function submit() {
    if (selected.length === 0 || pending) return;
    setPending(true);
    try {
      let targetId: string;
      if (conversation) {
        targetId = await addParticipants(conversation.id, selected);
      } else if (selected.length === 1) {
        targetId = await openDirectConversation(workspace.id, selected[0]);
      } else {
        targetId = await createGroupConversation(workspace.id, selected, groupName.trim() || null);
      }

      const summary = await fetchConversation(workspace.id, targetId).catch(() => null);
      if (summary) store.getState().upsertConversation(summary);
      onDone();
      router.push(routes.conversation(workspace.slug, targetId));
    } catch (error) {
      toast.error(getErrorMessage(error, "Couldn't start that conversation."));
      setPending(false);
    }
  }

  if (candidates.length === 0) {
    return (
      <>
        <DialogBody>
          <div className="rounded-2xl border border-dashed border-line-2 px-5 py-8 text-center">
            <p className="font-display text-lg font-semibold">
              {conversation ? "Everyone’s already here." : "It’s just you so far."}
            </p>
            <p className="mt-1 text-sm text-ink-3">
              {conversation ? "Invite more people to your workspace first." : "Invite your team and they’ll show up here."}
            </p>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={onDone}>
            Close
          </Button>
          <Button onClick={() => openDialog({ name: "invite" })}>Invite people</Button>
        </DialogFooter>
      </>
    );
  }

  const submitLabel = conversation
    ? conversation.kind === "direct"
      ? "Create group"
      : selected.length > 1
        ? `Add ${selected.length} people`
        : "Add to chat"
    : selected.length > 1
      ? `Create group of ${selected.length + 1}`
      : selected.length === 1
        ? `Message ${firstNameOf(members[selected[0]])}`
        : "Choose someone";

  return (
    <>
      <div className="px-6 pt-5">
        <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-xl border border-line-2 bg-surface px-2 py-1.5 focus-within:border-ink">
          <IconSearch size={16} className="ml-1 text-ink-3" />
          {selected.map((id) => (
            <span key={id} className="inline-flex h-7 items-center gap-1.5 rounded-full bg-paper-2 pl-1 pr-1 text-[13px]">
              <Avatar person={members[id]} size="xs" />
              {firstNameOf(members[id])}
              <button
                type="button"
                onClick={() => toggle(id)}
                className="flex size-5 items-center justify-center rounded-full text-ink-3 hover:bg-paper-3 hover:text-ink"
                aria-label={`Remove ${nameOf(members[id])}`}
              >
                <IconClose size={12} />
              </button>
            </span>
          ))}
          <input
            autoFocus
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setHighlight(0);
            }}
            onKeyDown={handleKeyDown}
            placeholder={selected.length ? "Add someone else" : "Search by name, email or role"}
            className="h-7 min-w-[140px] flex-1 bg-transparent px-1 text-[15px] outline-none placeholder:text-ink-4"
            role="combobox"
            aria-expanded="true"
            aria-controls="people-picker-list"
            aria-activedescendant={filtered[activeIndex] ? `person-${filtered[activeIndex].id}` : undefined}
          />
        </div>
      </div>

      <DialogBody className="pt-3">
        <div ref={listRef} id="people-picker-list" role="listbox" aria-multiselectable="true" className="flex max-h-[340px] flex-col">
          {filtered.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-ink-3">Nobody matches “{query}”.</p>
          ) : (
            filtered.map((member, index) => {
              const checked = selected.includes(member.id);
              return (
                <button
                  key={member.id}
                  id={`person-${member.id}`}
                  type="button"
                  role="option"
                  aria-selected={checked}
                  data-index={index}
                  onClick={() => toggle(member.id)}
                  onMouseMove={() => activeIndex !== index && setHighlight(index)}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-2xl px-2.5 py-2 text-left transition-colors [--avatar-ring:var(--surface)]",
                    index === activeIndex && "bg-paper [--avatar-ring:var(--paper)]",
                  )}
                >
                  <Avatar person={member} size="md" online={Boolean(online[member.id])} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14.5px] font-medium text-ink">{nameOf(member)}</span>
                    <span className="block truncate text-[13px] text-ink-3">{member.title || member.email}</span>
                  </span>
                  <span
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded-full border transition-colors",
                      checked ? "border-ink bg-ink text-paper" : "border-line-2",
                    )}
                  >
                    {checked ? <IconCheck size={12} strokeWidth={2.4} /> : null}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </DialogBody>

      {isNewGroup ? (
        <div className="animate-rise px-6 pt-3">
          <Input
            value={groupName}
            onChange={(event) => setGroupName(event.target.value)}
            maxLength={80}
            placeholder="Name the group (optional)"
          />
        </div>
      ) : null}

      <DialogFooter>
        <Button variant="ghost" onClick={onDone}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={selected.length === 0} loading={pending}>
          {submitLabel}
        </Button>
      </DialogFooter>
    </>
  );
}
