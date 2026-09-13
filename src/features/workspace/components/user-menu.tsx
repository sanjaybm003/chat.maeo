"use client";

import Link from "next/link";
import { useTransition } from "react";

import { Avatar } from "@/components/ui/avatar";
import { IconLogOut, IconMore, IconSliders, IconUsers } from "@/components/ui/icons";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuLabel,
  MenuRadioGroup,
  MenuRadioItem,
  MenuSeparator,
  MenuTrigger,
} from "@/components/ui/menu";
import { signOut } from "@/features/auth/actions";
import { disablePush } from "@/features/notifications/push-client";
import { usePreferences, type ThemePreference } from "@/lib/preferences";
import { routes } from "@/lib/routes";
import { nameOf } from "@/lib/utils";

import { useWorkspace } from "../store/workspace-provider";

export function UserMenu() {
  const me = useWorkspace((state) => state.me);
  const slug = useWorkspace((state) => state.workspace.slug);
  const live = useWorkspace((state) => state.connection === "live");
  const [preferences, updatePreferences] = usePreferences();
  const [signingOut, startSignOut] = useTransition();

  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-3 rounded-xl p-1.5 text-left transition-colors hover:bg-paper data-[state=open]:bg-paper"
        >
          <Avatar person={me} size="md" online={live} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-medium leading-tight text-ink">{nameOf(me)}</span>
            <span className="block truncate text-[12.5px] text-ink-3">{me.statusText || me.title || me.email}</span>
          </span>
          <IconMore size={18} className="shrink-0 text-ink-3" />
        </button>
      </MenuTrigger>

      <MenuContent side="top" align="start" className="w-[268px]">
        <div className="px-2.5 pb-2 pt-1.5">
          <p className="truncate text-sm font-medium text-ink">{me.fullName ?? nameOf(me)}</p>
          <p className="truncate font-mono text-[11px] text-ink-3">{me.email}</p>
        </div>
        <MenuSeparator />
        <MenuItem icon={<IconUsers size={17} />} asChild>
          <Link href={routes.settings(slug, "profile")}>Edit profile</Link>
        </MenuItem>
        <MenuItem icon={<IconSliders size={17} />} asChild>
          <Link href={routes.settings(slug, "preferences")}>Preferences</Link>
        </MenuItem>
        <MenuSeparator />
        <MenuLabel>Theme</MenuLabel>
        <MenuRadioGroup
          value={preferences.theme}
          onValueChange={(value) => updatePreferences({ theme: value as ThemePreference })}
        >
          <MenuRadioItem value="light" onSelect={(event) => event.preventDefault()}>
            Light
          </MenuRadioItem>
          <MenuRadioItem value="dark" onSelect={(event) => event.preventDefault()}>
            Dark
          </MenuRadioItem>
          <MenuRadioItem value="system" onSelect={(event) => event.preventDefault()}>
            Match system
          </MenuRadioItem>
        </MenuRadioGroup>
        <MenuSeparator />
        <MenuItem
          icon={<IconLogOut size={17} />}
          disabled={signingOut}
          onSelect={(event) => {
            event.preventDefault();
            startSignOut(async () => {
              await disablePush().catch(() => undefined);
              await signOut();
            });
          }}
        >
          {signingOut ? "Signing out…" : "Sign out"}
        </MenuItem>
      </MenuContent>
    </Menu>
  );
}
