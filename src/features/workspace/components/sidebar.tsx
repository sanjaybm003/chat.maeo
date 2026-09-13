"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";

import { SectionLabel } from "@/components/ui/field";
import { IconButton } from "@/components/ui/icon-button";
import { IconCompose, IconSearch, IconSliders, IconUserPlus, IconUsers } from "@/components/ui/icons";
import { Kbd } from "@/components/ui/kbd";
import { Segmented } from "@/components/ui/segmented";
import { useIsMac } from "@/hooks/use-hydrated";
import { routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

import { useWorkspace } from "../store/workspace-provider";
import { ConnectionBanner } from "./connection-banner";
import { ConversationList, type ConversationFilter } from "./conversation-list";
import { UserMenu } from "./user-menu";
import { WorkspaceSwitcher } from "./workspace-switcher";

export function Sidebar({ className }: { className?: string }) {
  const [filter, setFilter] = useState<ConversationFilter>("all");
  const openDialog = useWorkspace((state) => state.openDialog);
  const slug = useWorkspace((state) => state.workspace.slug);
  const memberCount = useWorkspace((state) => Object.keys(state.members).length);
  const unreadChats = useWorkspace(
    (state) => Object.values(state.conversations).filter((item) => item.unreadCount > 0).length,
  );
  const pathname = usePathname();
  const isMac = useIsMac();

  return (
    <aside
      className={cn(
        "h-full w-full shrink-0 flex-col bg-surface [--avatar-ring:var(--surface)] md:w-[308px] md:border-r md:border-line",
        className,
      )}
      aria-label="Workspace navigation"
    >
      <div className="flex items-center gap-1 px-2.5 pb-2 pt-2.5">
        <WorkspaceSwitcher />
        <IconButton label="New chat" onClick={() => openDialog({ name: "new-chat" })} tooltipSide="bottom">
          <IconCompose />
        </IconButton>
      </div>

      <div className="px-3">
        <button
          type="button"
          onClick={() => openDialog({ name: "palette" })}
          className="flex h-10 w-full items-center gap-2.5 rounded-xl border border-line bg-paper px-3 text-left text-[14px] text-ink-3 transition-colors hover:border-line-2 hover:text-ink-2"
        >
          <IconSearch size={16} />
          <span className="flex-1 truncate">Search people and messages</span>
          <Kbd className="hidden md:inline-flex">{isMac ? "⌘K" : "Ctrl K"}</Kbd>
        </button>
      </div>

      <div className="flex items-center justify-between px-4 pb-2 pt-5">
        <SectionLabel>Chats</SectionLabel>
        <Segmented<ConversationFilter>
          size="sm"
          label="Filter chats"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All" },
            { value: "unread", label: unreadChats > 0 ? `Unread ${unreadChats}` : "Unread" },
          ]}
        />
      </div>

      <ConnectionBanner />
      <ConversationList filter={filter} className="min-h-0 flex-1" />

      <nav className="flex flex-col gap-0.5 border-t border-line p-2" aria-label="Workspace">
        <NavItem
          href={routes.contacts(slug)}
          active={pathname.startsWith(routes.contacts(slug))}
          icon={<IconUsers />}
          label="Contacts"
          meta={String(memberCount)}
        />
        <NavItem onClick={() => openDialog({ name: "invite" })} icon={<IconUserPlus />} label="Invite people" />
        <NavItem
          href={routes.settings(slug)}
          active={pathname.startsWith(`/w/${slug}/settings`)}
          icon={<IconSliders />}
          label="Settings"
        />
      </nav>

      <div className="border-t border-line p-2">
        <UserMenu />
      </div>
    </aside>
  );
}

interface NavItemProps {
  icon: ReactNode;
  label: string;
  meta?: string;
  href?: string;
  active?: boolean;
  onClick?: () => void;
}

function NavItem({ icon, label, meta, href, active, onClick }: NavItemProps) {
  const classes = cn(
    "flex h-9 w-full items-center gap-3 rounded-xl px-2.5 text-[14px] transition-colors",
    active ? "bg-paper-2 font-medium text-ink" : "text-ink-2 hover:bg-paper hover:text-ink",
  );
  const content = (
    <>
      <span className={cn("flex size-5 items-center justify-center", active ? "text-ink" : "text-ink-3")}>{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {meta ? <span className="font-mono text-[11px] text-ink-4">{meta}</span> : null}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={classes} aria-current={active ? "page" : undefined}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={classes}>
      {content}
    </button>
  );
}
