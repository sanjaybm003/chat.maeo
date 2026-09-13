"use client";

import Link from "next/link";

import { WorkspaceGlyph } from "@/components/brand/workspace-glyph";
import { IconCheck, IconMail, IconPlus, IconSelector, IconSliders, IconUserPlus } from "@/components/ui/icons";
import { CountBadge } from "@/components/ui/kbd";
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from "@/components/ui/menu";
import { routes } from "@/lib/routes";
import { pluralize } from "@/lib/utils";

import { useWorkspace } from "../store/workspace-provider";

const ROLE_LABEL = { owner: "Owner", admin: "Admin", member: "Member" } as const;

export function WorkspaceSwitcher() {
  const workspace = useWorkspace((state) => state.workspace);
  const workspaces = useWorkspace((state) => state.workspaces);
  const memberCount = useWorkspace((state) => Object.keys(state.members).length);
  const activityElsewhere = useWorkspace((state) => state.activityElsewhere);
  const pendingCount = useWorkspace((state) => state.pendingInvitations.length);
  const openDialog = useWorkspace((state) => state.openDialog);

  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl p-1.5 text-left transition-colors hover:bg-paper data-[state=open]:bg-paper"
        >
          <span className="relative">
            <WorkspaceGlyph name={workspace.name} seed={workspace.slug} />
            {activityElsewhere || pendingCount > 0 ? (
              <span
                className="absolute -right-0.5 -top-0.5 size-2.5 rounded-full bg-accent ring-2 ring-surface"
                aria-label={pendingCount > 0 ? "You have workspace invitations" : "New messages in another workspace"}
              />
            ) : null}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate font-display text-[16px] font-semibold leading-tight tracking-[-0.01em] text-ink">
              {workspace.name}
            </span>
            <span className="block font-mono text-[11px] text-ink-3">{pluralize(memberCount, "person", "people")}</span>
          </span>
          <IconSelector size={16} className="shrink-0 text-ink-3" />
        </button>
      </MenuTrigger>

      <MenuContent className="w-[272px]">
        <MenuLabel>Workspaces</MenuLabel>
        {workspaces.map((item) => (
          <MenuItem key={item.id} asChild>
            <Link href={routes.workspace(item.slug)} className="h-11">
              <span className="flex min-w-0 flex-1 items-center gap-2.5">
                <WorkspaceGlyph name={item.name} seed={item.slug} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{item.name}</span>
                  <span className="block font-mono text-[10.5px] text-ink-3">{ROLE_LABEL[item.role]}</span>
                </span>
                {item.id === workspace.id ? <IconCheck size={16} className="text-ink" /> : null}
              </span>
            </Link>
          </MenuItem>
        ))}
        {pendingCount > 0 ? (
          <MenuItem asChild>
            <Link href={routes.onboarding.workspace} className="h-11">
              <span className="flex min-w-0 flex-1 items-center gap-2.5">
                <span className="flex size-7 items-center justify-center rounded-[9px] border border-dashed border-line-2 text-ink-3">
                  <IconMail size={14} />
                </span>
                <span className="flex-1 text-sm font-medium">Invitations</span>
                <CountBadge count={pendingCount} />
              </span>
            </Link>
          </MenuItem>
        ) : null}
        <MenuSeparator />
        <MenuItem icon={<IconUserPlus size={17} />} onSelect={() => openDialog({ name: "invite" })}>
          Invite people
        </MenuItem>
        <MenuItem icon={<IconSliders size={17} />} asChild>
          <Link href={routes.settings(workspace.slug, "workspace")}>Workspace settings</Link>
        </MenuItem>
        <MenuItem icon={<IconPlus size={17} />} asChild>
          <Link href={routes.onboarding.workspace}>Create a workspace</Link>
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
