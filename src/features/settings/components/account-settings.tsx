"use client";

import { useState, useTransition, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Field, FormError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { signOutEverywhere, updatePassword } from "@/features/auth/actions";
import { PasswordInput, PasswordMeter } from "@/features/auth/components/password-input";
import { disablePush } from "@/features/notifications/push-client";
import { useServerAction } from "@/hooks/use-server-action";

import { deleteAccount } from "../actions";
import { DELETE_ACCOUNT_PHRASE } from "../constants";
import { SettingsSection } from "./settings-chrome";

const PROVIDER_LABEL: Record<string, string> = {
  email: "Email and password",
  google: "Google",
};

export function AccountSettings({ email, provider }: { email: string; provider: string }) {
  return (
    <>
      <SettingsSection title="Email" description="Used to sign in and receive invitations.">
        <Input value={email} readOnly className="text-ink-2" aria-label="Email" />
        <p className="mt-2 font-mono text-[11px] uppercase tracking-[0.1em] text-ink-3">
          Signed in with {PROVIDER_LABEL[provider] ?? provider}
        </p>
      </SettingsSection>

      <SettingsSection title="Password" description="At least 8 characters with a number or symbol.">
        <PasswordForm />
      </SettingsSection>

      <SettingsSection title="Sessions" description="Lost a laptop? Sign out of maeosan on every device at once, this one included.">
        <SignOutEverywhere />
      </SettingsSection>

      <SettingsSection
        title="Delete account"
        tone="danger"
        description="Deletes your profile and the workspaces you own alone. Messages you sent stay, marked as a former member."
      >
        <DeleteAccount />
      </SettingsSection>
    </>
  );
}

function PasswordForm() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const action = useServerAction(updatePassword);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await action.run({ password, confirm });
    if (result.ok) {
      setPassword("");
      setConfirm("");
      toast.success("Password changed.");
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex max-w-[420px] flex-col gap-4">
      <FormError message={action.error && !action.fieldErrors.password && !action.fieldErrors.confirm ? action.error : null} />
      <Field label="New password" htmlFor="account-password" error={action.fieldErrors.password}>
        <PasswordInput id="account-password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} />
      </Field>
      <PasswordMeter password={password} />
      <Field label="Confirm new password" htmlFor="account-password-confirm" error={action.fieldErrors.confirm}>
        <PasswordInput id="account-password-confirm" autoComplete="new-password" value={confirm} onChange={(event) => setConfirm(event.target.value)} />
      </Field>
      <div>
        <Button type="submit" loading={action.pending} disabled={!password || !confirm}>
          Update password
        </Button>
      </div>
    </form>
  );
}

function SignOutEverywhere() {
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Sign out everywhere
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title="Sign out of every device?"
        description="You'll need to sign in again here and anywhere else you use maeosan."
        confirmLabel="Sign out everywhere"
        tone="neutral"
        onConfirm={() =>
          new Promise<void>(() =>
            startTransition(async () => {
              await disablePush().catch(() => undefined);
              await signOutEverywhere();
            }),
          )
        }
      />
    </>
  );
}

function DeleteAccount() {
  const [open, setOpen] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function confirmDeletion() {
    setError(null);
    const result = await deleteAccount(phrase);
    // On success the action redirects, so we only get here on failure.
    if (result && !result.ok) {
      setError(result.error);
      throw new Error(result.error);
    }
  }

  return (
    <>
      <Button variant="danger" onClick={() => setOpen(true)}>
        Delete my account
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) {
            setPhrase("");
            setError(null);
          }
        }}
        title="Delete your account?"
        description={
          <>
            This can’t be undone. Type <span className="font-mono text-ink">{DELETE_ACCOUNT_PHRASE}</span> to confirm.
          </>
        }
        confirmLabel="Delete account"
        confirmDisabled={phrase.trim().toLowerCase() !== DELETE_ACCOUNT_PHRASE}
        onConfirm={confirmDeletion}
      >
        <div className="flex flex-col gap-3">
          <FormError message={error} />
          <Input value={phrase} onChange={(event) => setPhrase(event.target.value)} autoFocus aria-label="Confirmation phrase" />
        </div>
      </ConfirmDialog>
    </>
  );
}
