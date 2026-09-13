"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PasswordInput, PasswordMeter } from "@/features/auth/components/password-input";
import { useServerAction } from "@/hooks/use-server-action";
import { personColorStyle } from "@/lib/colors";
import type { PersonColor, Profile } from "@/types/domain";

import { saveOnboardingProfile } from "../actions";
import { ColorPicker } from "./color-picker";

interface ProfileStepFormProps {
  profile: Profile;
  suggestedName: string | null;
  requirePassword: boolean;
  next?: string;
}

export function ProfileStepForm({ profile, suggestedName, requirePassword, next }: ProfileStepFormProps) {
  const router = useRouter();
  const [fullName, setFullName] = useState(profile.fullName ?? suggestedName ?? "");
  const [displayName, setDisplayName] = useState(profile.displayName ?? "");
  const [displayNameEdited, setDisplayNameEdited] = useState(Boolean(profile.displayName));
  const [title, setTitle] = useState(profile.title ?? "");
  const [color, setColor] = useState<PersonColor>(profile.color);
  const [password, setPassword] = useState("");
  const [redirecting, setRedirecting] = useState(false);
  const action = useServerAction(saveOnboardingProfile);

  const firstName = fullName.trim().split(/\s+/)[0] ?? "";
  const shownDisplayName = displayNameEdited ? displayName : firstName;
  const preview = {
    fullName: fullName.trim() || null,
    displayName: shownDisplayName.trim() || null,
    email: profile.email,
    avatarPath: profile.avatarPath,
    color,
  };

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await action.run({
      fullName,
      displayName: shownDisplayName,
      title,
      color,
      password: requirePassword ? password : undefined,
      next,
    });
    if (result.ok) {
      setRedirecting(true);
      router.push(result.data.redirectTo);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-6">
      <div
        className="flex items-center gap-4 rounded-[24px] border border-line bg-surface p-4 pr-5 [--avatar-ring:var(--surface)]"
        style={personColorStyle(color)}
      >
        <Avatar person={preview} size="xl" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-[22px] font-semibold leading-tight tracking-[-0.02em]">
            {preview.fullName ?? "Your name"}
          </p>
          <p className="truncate text-sm text-ink-3">{title.trim() || "What you do"}</p>
        </div>
        <span className="hidden rounded-[18px] rounded-br-md bg-person-tint px-3.5 py-2 text-sm text-ink sm:block">
          Your messages
        </span>
      </div>

      <FormError message={action.error} />

      <div className="grid gap-5 sm:grid-cols-2">
        <Field label="Full name" htmlFor="fullName" error={action.fieldErrors.fullName} className="sm:col-span-2">
          <Input
            id="fullName"
            autoComplete="name"
            autoFocus
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            aria-invalid={Boolean(action.fieldErrors.fullName)}
          />
        </Field>
        <Field label="What should people call you?" htmlFor="displayName" error={action.fieldErrors.displayName}>
          <Input
            id="displayName"
            autoComplete="nickname"
            value={shownDisplayName}
            onChange={(event) => {
              setDisplayNameEdited(true);
              setDisplayName(event.target.value);
            }}
            aria-invalid={Boolean(action.fieldErrors.displayName)}
          />
        </Field>
        <Field label="Role" htmlFor="title" error={action.fieldErrors.title} hint="Optional">
          <Input
            id="title"
            autoComplete="organization-title"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="Founder, Designer, Ops…"
          />
        </Field>
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-3 text-[13px] font-medium text-ink-2">Pick your color</legend>
        <ColorPicker value={color} onChange={setColor} />
        <p className="text-[13px] text-ink-3">It follows you everywhere: your avatar, your messages, your mentions.</p>
      </fieldset>

      {requirePassword ? (
        <div className="flex flex-col gap-3 rounded-[20px] border border-line bg-surface-2 p-4">
          <Field
            label="Set a password"
            htmlFor="password"
            error={action.fieldErrors.password}
            hint="You joined through an email link. A password lets you sign in anywhere."
          >
            <PasswordInput
              id="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={Boolean(action.fieldErrors.password)}
            />
          </Field>
          <PasswordMeter password={password} />
        </div>
      ) : null}

      <div className="flex items-center gap-3 pt-2">
        <Button type="submit" size="lg" loading={action.pending || redirecting}>
          Continue
        </Button>
        <p className="font-mono text-[11px] text-ink-4">You can change all of this later</p>
      </div>
    </form>
  );
}
