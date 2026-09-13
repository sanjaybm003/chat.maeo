"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ColorPicker } from "@/features/onboarding/components/color-picker";
import { removeAvatarFile, uploadAvatar } from "@/features/workspace/api/attachments";
import { useWorkspace, useWorkspaceStore } from "@/features/workspace/store/workspace-provider";
import { getErrorMessage } from "@/lib/errors";
import { cn } from "@/lib/utils";
import type { PersonColor } from "@/types/domain";

import { updateOwnProfile } from "../api";
import { SettingsSection } from "./settings-chrome";

const STATUS_SUGGESTIONS = ["🎧 Heads down", "📅 In meetings", "🚆 Commuting", "🤒 Out sick", "🌴 On vacation"];
const MAX_SOURCE_IMAGE_BYTES = 10 * 1024 * 1024;

export function ProfileSettings() {
  return (
    <>
      <SettingsSection title="Photo" description="Shown next to your name everywhere. Without one, your initials sit on your color.">
        <AvatarEditor />
      </SettingsSection>
      <ProfileForm />
    </>
  );
}

function AvatarEditor() {
  const store = useWorkspaceStore();
  const me = useWorkspace((state) => state.me);
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<"upload" | "remove" | null>(null);

  async function handleFile(file: File) {
    if (!file.type.startsWith("image/")) return void toast.error("Choose an image file.");
    if (file.size > MAX_SOURCE_IMAGE_BYTES) return void toast.error("That image is over 10 MB.");

    setBusy("upload");
    const previous = me.avatarPath;
    try {
      const path = await uploadAvatar(me.id, file);
      store.getState().setMe(await updateOwnProfile(me.id, { avatar_path: path }));
      if (previous) void removeAvatarFile(previous);
      toast.success("Photo updated.");
    } catch (error) {
      toast.error(getErrorMessage(error, "Couldn't upload that photo."));
    } finally {
      setBusy(null);
    }
  }

  async function removePhoto() {
    const previous = me.avatarPath;
    if (!previous) return;
    setBusy("remove");
    try {
      store.getState().setMe(await updateOwnProfile(me.id, { avatar_path: null }));
      void removeAvatarFile(previous);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex items-center gap-5 [--avatar-ring:var(--paper)]">
      <Avatar person={me} size="2xl" />
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => inputRef.current?.click()} loading={busy === "upload"}>
            {me.avatarPath ? "Change photo" : "Upload photo"}
          </Button>
          {me.avatarPath ? (
            <Button variant="ghost" size="sm" onClick={() => void removePhoto()} loading={busy === "remove"}>
              Remove
            </Button>
          ) : null}
        </div>
        <p className="text-[12.5px] text-ink-3">We crop it square and shrink it, so any photo works.</p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void handleFile(file);
          event.target.value = "";
        }}
      />
    </div>
  );
}

function ProfileForm() {
  const store = useWorkspaceStore();
  const me = useWorkspace((state) => state.me);
  const [fullName, setFullName] = useState(me.fullName ?? "");
  const [displayName, setDisplayName] = useState(me.displayName ?? "");
  const [title, setTitle] = useState(me.title ?? "");
  const [statusText, setStatusText] = useState(me.statusText ?? "");
  const [color, setColor] = useState<PersonColor>(me.color);
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const dirty =
    fullName !== (me.fullName ?? "") ||
    displayName !== (me.displayName ?? "") ||
    title !== (me.title ?? "") ||
    statusText !== (me.statusText ?? "") ||
    color !== me.color;

  async function save() {
    if (!fullName.trim()) {
      setNameError("Your name can't be empty.");
      return;
    }
    setNameError(null);
    setSaving(true);
    try {
      const profile = await updateOwnProfile(me.id, {
        full_name: fullName.trim().slice(0, 80),
        display_name: displayName.trim().slice(0, 40) || null,
        title: title.trim().slice(0, 80) || null,
        status_text: statusText.trim().slice(0, 100) || null,
        color,
      });
      store.getState().setMe(profile);
      toast.success("Profile saved.");
    } catch (error) {
      toast.error(getErrorMessage(error, "Couldn't save your profile."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <SettingsSection title="About you" description="Your teammates see this in contacts, chats and details.">
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Full name" htmlFor="settings-full-name" error={nameError} className="sm:col-span-2">
            <Input id="settings-full-name" value={fullName} onChange={(event) => setFullName(event.target.value)} maxLength={80} aria-invalid={Boolean(nameError)} />
          </Field>
          <Field label="Display name" htmlFor="settings-display-name" hint="What people call you.">
            <Input id="settings-display-name" value={displayName} onChange={(event) => setDisplayName(event.target.value)} maxLength={40} />
          </Field>
          <Field label="Role" htmlFor="settings-title" hint="Optional.">
            <Input id="settings-title" value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} />
          </Field>
        </div>
      </SettingsSection>

      <SettingsSection title="Status" description="A short note on what you're up to. Visible on your contact card.">
        <Input value={statusText} onChange={(event) => setStatusText(event.target.value)} maxLength={100} placeholder="What's happening?" />
        <div className="mt-3 flex flex-wrap gap-1.5">
          {STATUS_SUGGESTIONS.map((suggestion) => (
            <button
              key={suggestion}
              type="button"
              onClick={() => setStatusText(suggestion)}
              className={cn(
                "h-8 rounded-full border px-3 text-[13px] transition-colors",
                statusText === suggestion ? "border-ink bg-ink text-paper" : "border-line-2 bg-surface text-ink-2 hover:border-ink-4",
              )}
            >
              {suggestion}
            </button>
          ))}
          {statusText ? (
            <button type="button" onClick={() => setStatusText("")} className="h-8 rounded-full px-3 text-[13px] text-ink-3 hover:text-ink">
              Clear
            </button>
          ) : null}
        </div>
      </SettingsSection>

      <SettingsSection title="Your color" description="Tints your avatar, your message bubbles and your reactions.">
        <ColorPicker value={color} onChange={setColor} />
      </SettingsSection>

      <div className="sticky bottom-4 z-10 mt-2 flex justify-end">
        <div
          className={cn(
            "flex items-center gap-3 rounded-full border border-line bg-surface p-1.5 pl-5 shadow-pop transition-all duration-200",
            dirty ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-3 opacity-0",
          )}
          aria-hidden={!dirty}
        >
          <span className="text-[13px] text-ink-3">Unsaved changes</span>
          <Button size="sm" onClick={() => void save()} loading={saving}>
            Save profile
          </Button>
        </div>
      </div>
    </>
  );
}
