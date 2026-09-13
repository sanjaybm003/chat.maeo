"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { useServerAction } from "@/hooks/use-server-action";
import { routes } from "@/lib/routes";

import { signUp } from "../actions";
import { AuthHeading } from "./auth-heading";
import { PENDING_EMAIL_KEY } from "./check-email-view";
import { AuthDivider, GoogleButton } from "./google-button";
import { PasswordInput, PasswordMeter } from "./password-input";

interface SignupFormProps {
  next: string;
  googleEnabled: boolean;
  invited: boolean;
}

export function SignupForm({ next, googleEnabled, invited }: SignupFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [redirecting, setRedirecting] = useState(false);
  const action = useServerAction(signUp);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const result = await action.run({ email, password, next });
    if (!result.ok) return;

    setRedirecting(true);
    if (result.data.needsConfirmation) {
      try {
        sessionStorage.setItem(PENDING_EMAIL_KEY, email.trim().toLowerCase());
      } catch {
        // Only used to show the address on the next screen.
      }
      router.push(result.data.redirectTo);
      return;
    }
    router.replace(result.data.redirectTo);
    router.refresh();
  }

  const loginHref = next ? `${routes.login}?next=${encodeURIComponent(next)}` : routes.login;

  return (
    <div className="animate-rise">
      <AuthHeading eyebrow={invited ? "You’re invited" : undefined} title={invited ? "Join your team." : "Start talking."}>
        {invited
          ? "Create your account with the email your invite was sent to."
          : "Create your account. Setting up your workspace takes under a minute."}
      </AuthHeading>

      {googleEnabled ? (
        <>
          <GoogleButton next={next} label="Sign up with Google" />
          <AuthDivider />
        </>
      ) : null}

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

        <Field
          label="Password"
          htmlFor="password"
          error={action.fieldErrors.password}
          hint="At least 8 characters, with a number or symbol."
        >
          <PasswordInput
            id="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            aria-invalid={Boolean(action.fieldErrors.password)}
          />
        </Field>
        <PasswordMeter password={password} />

        <Button type="submit" size="lg" className="mt-2 w-full" loading={action.pending || redirecting}>
          Create account
        </Button>

        <p className="text-[12.5px] leading-relaxed text-ink-3">
          By creating an account you agree to use maeosan responsibly with your team.
        </p>
      </form>

      <p className="mt-8 text-sm text-ink-3">
        Already have an account?{" "}
        <Link href={loginHref} className="font-medium text-ink underline decoration-line-2 underline-offset-4 hover:decoration-ink">
          Sign in
        </Link>
      </p>
    </div>
  );
}
