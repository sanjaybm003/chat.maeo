"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { IconArrowLeft, IconCopy, IconMail, IconMore, IconSearch, IconUserPlus } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import { LocalTime } from "@/components/ui/local-time";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { Segmented } from "@/components/ui/segmented";
import { inviteToWorkspace, revokeInvitation } from "@/features/invitations/actions";
import { DELIVERY_ISSUE_REASON } from "@/features/invitations/delivery-issues";
import {
  fetchPendingInvitations,
  removeMember,
  transferOwnership,
  updateMemberRole,
  type WorkspaceInvitation,
} from "@/features/workspace/api/members";
import { INVITES_CHANGED_EVENT } from "@/features/workspace/components/invite-dialog";
import { useMessagePerson } from "@/features/workspace/hooks/use-open-conversation";
import { memberSearchFields } from "@/features/workspace/lib/search-fields";
import { useWorkspace, useWorkspaceStore } from "@/features/workspace/store/workspace-provider";
import { personColorStyle } from "@/lib/colors";
import { getErrorMessage } from "@/lib/errors";
import { rankItems } from "@/lib/search/fuzzy";
import { routes } from "@/lib/routes";
import { cn, nameOf } from "@/lib/utils";
import type { Member } from "@/types/domain";

type Tab = "everyone" | "online" | "invited";

const ROLE_LABEL = { owner: "Owner", admin: "Admin", member: "Member" } as const;

function usePendingInvitations(workspaceId: string) {
  const [state, setState] = useState<{ items: WorkspaceInvitation[]; loaded: boolean }>({ items: [], loaded: false });
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    fetchPendingInvitations(workspaceId)
      .then((items) => {
        if (!cancelled) setState({ items, loaded: true });
      })
      .catch(() => {
        if (!cancelled) setState((current) => ({ ...current, loaded: true }));
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, version]);

  useEffect(() => {
    window.addEventListener(INVITES_CHANGED_EVENT, refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener(INVITES_CHANGED_EVENT, refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [refresh]);

  return { ...state, refresh };
}

export function ContactsScreen() {
  const members = useWorkspace((state) => state.members);
  const online = useWorkspace((state) => state.online);
  const workspace = useWorkspace((state) => state.workspace);
  const openDialog = useWorkspace((state) => state.openDialog);
  const [tab, setTab] = useState<Tab>("everyone");
  const [query, setQuery] = useState("");
  const invitations = usePendingInvitations(workspace.id);

  const everyone = useMemo(
    () =>
      Object.values(members).sort(
        (a, b) => Number(Boolean(online[b.id])) - Number(Boolean(online[a.id])) || nameOf(a).localeCompare(nameOf(b)),
      ),
    [members, online],
  );
  const onlineCount = everyone.filter((member) => online[member.id]).length;
  const visible = rankItems(
    everyone.filter((member) => tab !== "online" || online[member.id]),
    query,
    memberSearchFields,
  );
  const visibleInvites = invitations.items.filter((invite) => invite.email.includes(query.trim().toLowerCase()));

  const tabs: Array<{ value: Tab; label: string }> = [
    { value: "everyone", label: `Everyone ${everyone.length}` },
    { value: "online", label: `Online ${onlineCount}` },
  ];
  if (invitations.items.length > 0) tabs.push({ value: "invited", label: `Invited ${invitations.items.length}` });

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

        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">{workspace.name}</p>
            <h1 className="mt-2 font-display text-[44px] font-semibold leading-none tracking-[-0.04em]">Contacts</h1>
            <p className="mt-3 text-[15px] text-ink-3">
              {everyone.length} {everyone.length === 1 ? "person" : "people"} · {onlineCount} online now
            </p>
          </div>
          <Button onClick={() => openDialog({ name: "invite" })}>
            <IconUserPlus size={17} />
            Invite people
          </Button>
        </div>

        <div className="mt-9 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Segmented<Tab> label="Filter contacts" value={tab === "invited" && invitations.items.length === 0 ? "everyone" : tab} onChange={setTab} options={tabs} className="self-start" />
          <div className="relative sm:w-72">
            <IconSearch size={16} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3" />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={tab === "invited" ? "Search invitations" : "Search contacts"}
              className="h-10 pl-10"
              aria-label="Search contacts"
            />
          </div>
        </div>

        <div className="mt-6">
          {tab === "invited" && invitations.items.length > 0 ? (
            <InvitationList invitations={visibleInvites} onChanged={() => void invitations.refresh()} />
          ) : visible.length === 0 ? (
            <div className="rounded-[24px] border border-dashed border-line-2 px-6 py-14 text-center">
              <p className="font-display text-xl font-semibold">
                {query ? `Nobody matches “${query}”.` : tab === "online" ? "Nobody else is online right now." : "No contacts yet."}
              </p>
              <p className="mt-1 text-sm text-ink-3">People you invite show up here as soon as they join.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((member) => (
                <ContactCard key={member.id} member={member} online={Boolean(online[member.id])} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ContactCard({ member, online }: { member: Member; online: boolean }) {
  const meId = useWorkspace((state) => state.me.id);
  const messagePerson = useMessagePerson();
  const isMe = member.id === meId;

  return (
    <article
      className="relative flex flex-col overflow-hidden rounded-[24px] border border-line bg-surface p-4 [--avatar-ring:var(--surface)]"
      style={personColorStyle(member.color)}
    >
      <svg viewBox="0 0 72 72" className="absolute right-0 top-0 size-[72px]" aria-hidden="true">
        <path d="M72 0v72A72 72 0 0 1 0 0Z" style={{ fill: "var(--person-tint)" }} />
      </svg>

      <div className="relative flex items-start gap-3">
        <Avatar person={member} size="lg" online={online} />
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="truncate text-[15px] font-semibold text-ink">
            {nameOf(member)}
            {isMe ? <span className="ml-1.5 font-mono text-[11px] font-normal text-ink-3">you</span> : null}
          </p>
          <p className="truncate text-[13px] text-ink-3">{member.title || member.email}</p>
        </div>
      </div>

      <p className={cn("relative mt-3 line-clamp-2 min-h-[20px] text-[13px]", member.statusText ? "text-ink-2" : "text-ink-4")}>
        {member.statusText || (online ? "Online now" : " ")}
      </p>

      <div className="relative mt-4 flex items-center gap-2">
        {member.role !== "member" ? (
          <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.1em] text-ink-3">
            {ROLE_LABEL[member.role]}
          </span>
        ) : null}
        <span className="flex-1" />
        <MemberActions member={member} />
        {!isMe ? (
          <Button size="sm" variant="secondary" onClick={() => void messagePerson(member.id)}>
            Message
          </Button>
        ) : null}
      </div>
    </article>
  );
}

function MemberActions({ member }: { member: Member }) {
  const store = useWorkspaceStore();
  const me = useWorkspace((state) => state.me);
  const myRole = useWorkspace((state) => state.myRole);
  const workspace = useWorkspace((state) => state.workspace);
  const [confirm, setConfirm] = useState<"remove" | "transfer" | null>(null);

  const isMe = member.id === me.id;
  const canChangeRole = myRole !== "member" && member.role !== "owner" && !isMe;
  const canRemove = !isMe && member.role !== "owner" && (myRole === "owner" || (myRole === "admin" && member.role === "member"));
  const canTransfer = myRole === "owner" && !isMe;
  if (!canChangeRole && !canRemove && !canTransfer) return null;

  async function changeRole(role: "admin" | "member") {
    try {
      await updateMemberRole(workspace.id, member.id, role);
      store.getState().upsertMember({ ...member, role });
      toast.success(`${nameOf(member)} is now ${role === "admin" ? "an admin" : "a member"}.`);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  }

  async function remove() {
    try {
      await removeMember(workspace.id, member.id);
      store.getState().removeMember(member.id);
      toast.success(`${nameOf(member)} was removed from ${workspace.name}.`);
    } catch (error) {
      toast.error(getErrorMessage(error));
      throw error;
    }
  }

  async function transfer() {
    try {
      await transferOwnership(workspace.id, member.id);
      store.getState().upsertMember({ ...member, role: "owner" });
      const self = store.getState().members[me.id];
      if (self) store.getState().upsertMember({ ...self, role: "admin" });
      toast.success(`${nameOf(member)} now owns ${workspace.name}.`);
    } catch (error) {
      toast.error(getErrorMessage(error));
      throw error;
    }
  }

  return (
    <>
      <Menu>
        <MenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Manage ${nameOf(member)}`}>
            <IconMore size={17} />
          </Button>
        </MenuTrigger>
        <MenuContent align="end">
          <MenuLabel>Manage</MenuLabel>
          {canChangeRole ? (
            member.role === "admin" ? (
              <MenuItem onSelect={() => void changeRole("member")}>Make member</MenuItem>
            ) : (
              <MenuItem onSelect={() => void changeRole("admin")}>Make admin</MenuItem>
            )
          ) : null}
          {canTransfer ? <MenuItem onSelect={() => setConfirm("transfer")}>Transfer ownership</MenuItem> : null}
          {canRemove ? (
            <>
              <MenuSeparator />
              <MenuItem tone="danger" onSelect={() => setConfirm("remove")}>
                Remove from workspace
              </MenuItem>
            </>
          ) : null}
        </MenuContent>
      </Menu>

      <ConfirmDialog
        open={confirm === "remove"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={`Remove ${nameOf(member)}?`}
        description={`They'll lose access to ${workspace.name} and leave all of its group chats. You can invite them again later.`}
        confirmLabel="Remove"
        onConfirm={remove}
      />
      <ConfirmDialog
        open={confirm === "transfer"}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={`Make ${nameOf(member)} the owner?`}
        description="They'll be able to delete the workspace. You'll stay on as an admin."
        confirmLabel="Transfer ownership"
        tone="neutral"
        onConfirm={transfer}
      />
    </>
  );
}

function InvitationList({ invitations, onChanged }: { invitations: WorkspaceInvitation[]; onChanged: () => void }) {
  const workspaceId = useWorkspace((state) => state.workspace.id);
  const [busy, setBusy] = useState<string | null>(null);

  async function copyLink(token: string) {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${routes.invite(token)}`);
      toast.success("Invite link copied.");
    } catch {
      toast.error("Couldn't copy the link.");
    }
  }

  async function resend(invite: WorkspaceInvitation) {
    setBusy(invite.id);
    const result = await inviteToWorkspace({ workspaceId, emails: [invite.email], role: invite.role === "admin" ? "admin" : "member" });
    setBusy(null);
    if (!result.ok) return void toast.error(result.error);
    if (result.data.undelivered.length > 0) {
      toast.error(`${DELIVERY_ISSUE_REASON[result.data.emailIssue ?? "failed"]} Copy the link instead.`);
    }
    else toast.success(`Sent again to ${invite.email}.`);
    onChanged();
  }

  async function revoke(invite: WorkspaceInvitation) {
    setBusy(invite.id);
    const result = await revokeInvitation(invite.id);
    setBusy(null);
    if (!result.ok) return void toast.error(result.error);
    toast.success(`Invitation for ${invite.email} cancelled.`);
    onChanged();
  }

  if (invitations.length === 0) {
    return <p className="rounded-[24px] border border-dashed border-line-2 px-6 py-10 text-center text-sm text-ink-3">No invitations match.</p>;
  }

  return (
    <ul className="divide-y divide-line overflow-hidden rounded-[24px] border border-line bg-surface">
      {invitations.map((invite) => (
        <li key={invite.id} className="flex flex-wrap items-center gap-3 px-4 py-3.5">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full border border-dashed border-line-2 text-ink-3">
            <IconMail size={17} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14.5px] font-medium">{invite.email}</p>
            <p className="text-[12.5px] text-ink-3">
              Invited <LocalTime iso={invite.createdAt} format="short" /> · expires <LocalTime iso={invite.expiresAt} format="short" />
              {invite.role === "admin" ? " · Admin" : ""}
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => void copyLink(invite.token)}>
              <IconCopy size={15} />
              Link
            </Button>
            <Button size="sm" variant="ghost" onClick={() => void resend(invite)} disabled={busy === invite.id}>
              Resend
            </Button>
            <Button size="sm" variant="danger-ghost" onClick={() => void revoke(invite)} disabled={busy === invite.id}>
              Revoke
            </Button>
          </div>
        </li>
      ))}
    </ul>
  );
}
