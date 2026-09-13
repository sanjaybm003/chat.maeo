"use client";

import Link from "next/link";

import { Mosaic } from "@/components/brand/mosaic";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { SectionLabel } from "@/components/ui/field";
import { PendingInviteCard } from "@/features/invitations/components/pending-invite-card";
import { useHydrated } from "@/hooks/use-hydrated";
import { routes } from "@/lib/routes";
import { firstNameOf, nameOf } from "@/lib/utils";

import { useMessagePerson } from "../hooks/use-open-conversation";
import { useWorkspace } from "../store/workspace-provider";

function greeting(hour: number) {
  if (hour < 5) return "Up late";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function seedFrom(id: string) {
  return id.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

const VISIBLE_PEOPLE = 9;

export function WorkspaceHome() {
  const me = useWorkspace((state) => state.me);
  const workspace = useWorkspace((state) => state.workspace);
  const members = useWorkspace((state) => state.members);
  const online = useWorkspace((state) => state.online);
  const pendingInvitations = useWorkspace((state) => state.pendingInvitations);
  const openDialog = useWorkspace((state) => state.openDialog);
  const messagePerson = useMessagePerson();
  const hydrated = useHydrated();

  const others = Object.values(members)
    .filter((member) => member.id !== me.id)
    .sort((a, b) => Number(Boolean(online[b.id])) - Number(Boolean(online[a.id])) || nameOf(a).localeCompare(nameOf(b)));
  const onlineCount = others.filter((member) => online[member.id]).length;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-[780px] flex-col justify-center px-8 py-14 lg:px-12">
        <div className="size-[88px] overflow-hidden rounded-[26px]">
          <Mosaic cols={2} rows={2} seed={seedFrom(workspace.id)} className="size-full" />
        </div>

        <p className="mt-10 font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">{workspace.name}</p>
        <h1 className="mt-3 font-display text-[44px] font-semibold leading-[0.98] tracking-[-0.04em] text-ink lg:text-[56px]">
          {hydrated ? greeting(new Date().getHours()) : "Hello"}, {firstNameOf(me)}.
        </h1>
        <p className="mt-4 max-w-[520px] text-[17px] leading-relaxed text-ink-3">
          {others.length === 0
            ? "It’s just you so far. Invite the people you work with and they’ll appear here as contacts."
            : onlineCount > 0
              ? `${onlineCount} ${onlineCount === 1 ? "person is" : "people are"} around right now. Tap a face to start talking.`
              : "Pick someone to talk to, or open a chat from the list."}
        </p>

        <div className="mt-8 flex flex-wrap gap-2">
          <Button size="lg" onClick={() => openDialog({ name: others.length ? "new-chat" : "invite" })}>
            {others.length ? "Start a chat" : "Invite your team"}
          </Button>
          {others.length ? (
            <Button size="lg" variant="secondary" onClick={() => openDialog({ name: "invite" })}>
              Invite people
            </Button>
          ) : null}
        </div>

        {pendingInvitations.length > 0 ? (
          <section className="mt-14">
            <SectionLabel>Invitations for you</SectionLabel>
            <div className="mt-4 flex flex-col gap-2">
              {pendingInvitations.map((invitation) => (
                <PendingInviteCard key={invitation.token} invitation={invitation} />
              ))}
            </div>
          </section>
        ) : null}

        {others.length > 0 ? (
          <section className="mt-14">
            <div className="flex items-center justify-between">
              <SectionLabel>Your people</SectionLabel>
              {others.length > VISIBLE_PEOPLE ? (
                <Link href={routes.contacts(workspace.slug)} className="text-[13px] text-ink-3 hover:text-ink">
                  See all {others.length}
                </Link>
              ) : null}
            </div>
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {others.slice(0, VISIBLE_PEOPLE).map((member) => (
                <button
                  key={member.id}
                  type="button"
                  onClick={() => void messagePerson(member.id)}
                  className="group flex items-center gap-3 rounded-2xl border border-line bg-surface p-3 text-left transition-[border-color,transform] duration-150 [--avatar-ring:var(--surface)] hover:-translate-y-px hover:border-line-2"
                >
                  <Avatar person={member} size="md" online={Boolean(online[member.id])} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium text-ink">{nameOf(member)}</span>
                    <span className="block truncate text-[12.5px] text-ink-3">
                      {online[member.id] ? "Online" : member.statusText || member.title || "Say hello"}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
