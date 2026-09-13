"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/field";
import { useServerAction } from "@/hooks/use-server-action";

import { updatePassword } from "../actions";
import { AuthHeading } from "./auth-heading";
import { PasswordInput, PasswordMeter } from "./password-input";

export function ResetPasswordForm({ email }: { email: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [redirecting, setRedirecting] = useState(false);
  const action = useServerAction(updatePassword);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await action.run({ password, confirm });
    if (!result.ok) return;
    setRedirecting(true);
    toast.success("Password updated.");
    router.replace(result.data.redirectTo);
    router.refresh();
  }

  return (
    <div className="animate-rise">
      <AuthHeading title="Choose a new password.">
        For <span className="font-medium text-ink">{email}</span>. You’ll stay signed in on this device.
      </AuthHeading>

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <FormError message={action.error} />
        <Field label="New password" htmlFor="password" error={action.fieldErrors.password}>
          <PasswordInput
            id="password"
            autoComplete="new-password"
            autoFocus
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={Boolean(action.fieldErrors.password)}
          />
        </Field>
        <PasswordMeter password={password} />
        <Field label="Type it again" htmlFor="confirm" error={action.fieldErrors.confirm}>
          <PasswordInput
            id="confirm"
            autoComplete="new-password"
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            aria-invalid={Boolean(action.fieldErrors.confirm)}
          />
        </Field>
        <Button type="submit" size="lg" className="mt-2 w-full" loading={action.pending || redirecting}>
          Save password
        </Button>
      </form>
    </div>
  );
}
