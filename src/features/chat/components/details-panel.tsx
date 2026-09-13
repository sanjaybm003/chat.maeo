"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { SectionLabel } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { IconClose, IconCopy, IconUserPlus } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { AgentDetails } from "@/features/ai/components/agent-details";
import { leaveConversation, renameConversation, setConversationMuted } from "@/features/workspace/api/conversations";
import { ConversationAvatar } from "@/features/workspace/components/conversation-avatar";
import { useMessagePerson } from "@/features/workspace/hooks/use-open-conversation";
import { useWorkspace, useWorkspaceStore } from "@/features/workspace/store/workspace-provider";
import { personColorStyle } from "@/lib/colors";
import { formatLastSeen } from "@/lib/dates";
import { getErrorMessage } from "@/lib/errors";
import { routes } from "@/lib/routes";
import { nameOf } from "@/lib/utils";
import type { Conversation } from "@/types/domain";

import { conversationTitle, directPartner } from "../lib/conversation-meta";

const ROLE_LABEL = { owner: "Owner", admin: "Admin", member: "Member" } as const;

export function DetailsPanel({ conversation, onClose }: { conversation: Conversation; onClose: () => void }) {
  return (
    <aside
      className="fixed inset-0 z-40 flex flex-col bg-surface [--avatar-ring:var(--surface)] lg:static lg:z-auto lg:w-[340px] lg:shrink-0 lg:animate-fade-in lg:border-l lg:border-line"
      aria-label="Conversation details"
    >
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-line px-5">
        <p className="font-display text-[17px] font-semibold tracking-[-0.01em]">Details</p>
        <IconButton label="Close details" onClick={onClose}>
          <IconClose />
        </IconButton>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {conversation.agentId ? (
          <AgentDetails conversation={conversation} />
        ) : conversation.kind === "direct" ? (
          <DirectDetails conversation={conversation} />
        ) : (
          <GroupDetails conversation={conversation} />
        )}
        <MuteRow conversation={conversation} />
      </div>
    </aside>
  );
}

function DirectDetails({ conversation }: { conversation: Conversation }) {
  const members = useWorkspace((state) => state.members);
  const meId = useWorkspace((state) => state.me.id);
  const online = useWorkspace((state) => state.online);
  const away = useWorkspace((state) => state.away);
  const openDialog = useWorkspace((state) => state.openDialog);
  const partner = directPartner(conversation, members, meId);

  if (!partner) {
    return <p className="p-5 text-sm text-ink-3">This person is no longer part of the workspace. The history stays with you.</p>;
  }

  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(partner!.email);
      toast.success("Email copied.");
    } catch {
      toast.error("Couldn't copy.");
    }
  }

  return (
    <div style={personColorStyle(partner.color)}>
      <div className="h-24 bg-person" aria-hidden="true" />
      <div className="-mt-12 px-5">
        <Avatar person={partner} size="2xl" online={Boolean(online[partner.id])} className="rounded-full ring-4 ring-surface" />
        <h2 className="mt-3 font-display text-[24px] font-semibold leading-tight tracking-[-0.02em]">{nameOf(partner)}</h2>
        {partner.fullName && partner.displayName && partner.displayName !== partner.fullName ? (
          <p className="text-sm text-ink-3">{partner.fullName}</p>
        ) : null}
        <p className="mt-1 text-sm text-ink-2">{partner.title || ROLE_LABEL[partner.role]}</p>
        {partner.statusText ? (
          <p className="mt-3 rounded-2xl bg-person-tint px-3 py-2 text-[13.5px] text-ink">{partner.statusText}</p>
        ) : null}
      </div>

      <dl className="mt-6 flex flex-col border-y border-line">
        <DetailRow label="Status">
          {online[partner.id] ? (
            <span className="text-grass">Online now</span>
          ) : away[partner.id] ? (
            "Away"
          ) : partner.lastSeenAt ? (
            `Last seen ${formatLastSeen(partner.lastSeenAt)}`
          ) : (
            "Offline"
          )}
        </DetailRow>
        <DetailRow label="Email">
          <button type="button" onClick={() => void copyEmail()} className="flex min-w-0 items-center gap-1.5 hover:text-ink">
            <span className="truncate">{partner.email}</span>
            <IconCopy size={14} className="shrink-0 text-ink-4" />
          </button>
        </DetailRow>
        <DetailRow label="Role">{ROLE_LABEL[partner.role]}</DetailRow>
      </dl>

      <div className="p-5">
        <Button
          variant="secondary"
          className="w-full"
          onClick={() => openDialog({ name: "add-people", conversationId: conversation.id })}
        >
          <IconUserPlus size={17} />
          Start a group with {nameOf(partner)}
        </Button>
      </div>
    </div>
  );
}

function GroupDetails({ conversation }: { conversation: Conversation }) {
  const store = useWorkspaceStore();
  const router = useRouter();
  const members = useWorkspace((state) => state.members);
  const meId = useWorkspace((state) => state.me.id);
  const slug = useWorkspace((state) => state.workspace.slug);
  const online = useWorkspace((state) => state.online);
  const openDialog = useWorkspace((state) => state.openDialog);
  const messagePerson = useMessagePerson();
  const [name, setName] = useState(conversation.name ?? "");
  const [confirmLeave, setConfirmLeave] = useState(false);

  async function saveName() {
    const next = name.trim() || null;
    if (next === conversation.name) return;
    try {
      await renameConversation(conversation.id, next);
      store.getState().patchConversation(conversation.id, { name: next });
    } catch (error) {
      setName(conversation.name ?? "");
      toast.error(getErrorMessage(error, "Couldn't rename the group."));
    }
  }

  async function leave() {
    try {
      await leaveConversation(conversation.id);
      store.getState().removeConversation(conversation.id);
      router.replace(routes.workspace(slug));
      toast.success("You left the group.");
    } catch (error) {
      toast.error(getErrorMessage(error, "Couldn't leave the group."));
    }
  }

  const participants = [...conversation.participants].sort((a, b) =>
    a.userId === meId ? -1 : b.userId === meId ? 1 : nameOf(members[a.userId]).localeCompare(nameOf(members[b.userId])),
  );

  return (
    <div>
      <div className="flex flex-col items-start gap-4 px-5 pt-6">
        <ConversationAvatar conversation={conversation} size="xl" />
        <div className="w-full">
          <label htmlFor="group-name" className="text-[13px] font-medium text-ink-2">
            Group name
          </label>
          <Input
            id="group-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={() => void saveName()}
            onKeyDown={(event) => {
              if (event.key === "Enter") event.currentTarget.blur();
            }}
            maxLength={80}
            placeholder={conversationTitle({ ...conversation, name: null }, members, meId)}
            className="mt-1.5"
          />
        </div>
      </div>

      <div className="mt-6 flex items-center justify-between px-5">
        <SectionLabel>{conversation.participants.length} people</SectionLabel>
        <Button size="sm" variant="ghost" onClick={() => openDialog({ name: "add-people", conversationId: conversation.id })}>
          <IconUserPlus size={15} />
          Add
        </Button>
      </div>

      <ul className="mt-1 flex flex-col px-2">
        {participants.map((participant) => {
          const member = members[participant.userId] ?? null;
          const isMe = participant.userId === meId;
          return (
            <li key={participant.userId}>
              <button
                type="button"
                disabled={isMe || !member}
                onClick={() => void messagePerson(participant.userId)}
                className="flex w-full items-center gap-3 rounded-2xl px-3 py-2 text-left transition-colors enabled:hover:bg-paper [&:hover]:[--avatar-ring:var(--paper)]"
              >
                <Avatar person={member} size="md" online={Boolean(online[participant.userId])} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-medium">
                    {nameOf(member)}
                    {isMe ? <span className="ml-1.5 font-mono text-[11px] font-normal text-ink-3">you</span> : null}
                  </span>
                  <span className="block truncate text-[12.5px] text-ink-3">{member?.title || (member ? ROLE_LABEL[member.role] : "")}</span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>

      <div className="border-t border-line p-5">
        <Button variant="danger-ghost" className="w-full" onClick={() => setConfirmLeave(true)}>
          Leave group
        </Button>
      </div>

      <ConfirmDialog
        open={confirmLeave}
        onOpenChange={setConfirmLeave}
        title="Leave this group?"
        description="You won’t get new messages. Someone in the group can add you back."
        confirmLabel="Leave group"
        onConfirm={leave}
      />
    </div>
  );
}

function MuteRow({ conversation }: { conversation: Conversation }) {
  const store = useWorkspaceStore();

  async function toggle(muted: boolean) {
    store.getState().patchConversation(conversation.id, { muted });
    try {
      await setConversationMuted(conversation.id, muted);
    } catch (error) {
      store.getState().patchConversation(conversation.id, { muted: !muted });
      toast.error(getErrorMessage(error));
    }
  }

  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 border-t border-line px-5 py-4">
      <span>
        <span className="block text-[14px] font-medium">Mute notifications</span>
        <span className="block text-[12.5px] text-ink-3">No sounds, pop-ups or red badges.</span>
      </span>
      <Switch checked={conversation.muted} onCheckedChange={(checked) => void toggle(checked)} />
    </label>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-line px-5 py-3 text-sm last:border-b-0">
      <dt className="shrink-0 text-ink-3">{label}</dt>
      <dd className="min-w-0 text-right text-ink-2">{children}</dd>
    </div>
  );
}
