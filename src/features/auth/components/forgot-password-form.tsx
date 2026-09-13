"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useServerAction } from "@/hooks/use-server-action";
import { routes } from "@/lib/routes";

import { requestPasswordReset } from "../actions";
import { AuthHeading } from "./auth-heading";
import { EmailSentPanel } from "./email-sent-panel";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const action = useServerAction(requestPasswordReset);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await action.run({ email });
    if (result.ok) setSentTo(email.trim());
  }

  if (sentTo) {
    return (
      <EmailSentPanel
        email={sentTo}
        title="Reset link sent."
        body="If there’s an account for this address, you’ll get an email with a link to choose a new password."
        onBack={() => setSentTo(null)}
        onResend={() => requestPasswordReset({ email: sentTo })}
      />
    );
  }

  return (
    <div className="animate-rise">
      <AuthHeading title="Forgot it? Happens.">
        Enter the email you use for maeosan and we’ll send you a link to set a new password.
      </AuthHeading>

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <FormError message={action.error} />
        <Field label="Work email" htmlFor="email" error={action.fieldErrors.email}>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            autoFocus
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            aria-invalid={Boolean(action.fieldErrors.email)}
            placeholder="you@company.com"
          />
        </Field>
        <Button type="submit" size="lg" className="mt-2 w-full" loading={action.pending}>
          Send reset link
        </Button>
      </form>

      <p className="mt-8 text-sm text-ink-3">
        Remembered it?{" "}
        <Link href={routes.login} className="font-medium text-ink underline decoration-line-2 underline-offset-4 hover:decoration-ink">
          Back to sign in
        </Link>
      </p>
    </div>
  );
}
