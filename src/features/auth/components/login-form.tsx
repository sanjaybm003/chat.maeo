"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/button";
import { Field, FormError } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Segmented } from "@/components/ui/segmented";
import { useServerAction } from "@/hooks/use-server-action";
import { routes } from "@/lib/routes";

import { sendSignInLink, signInWithPassword } from "../actions";
import { AuthHeading } from "./auth-heading";
import { EmailSentPanel } from "./email-sent-panel";
import { AuthDivider, GoogleButton } from "./google-button";
import { PasswordInput } from "./password-input";

type Method = "password" | "link";

interface LoginFormProps {
  next: string;
  notice: string | null;
  initialMethod?: Method;
  googleEnabled: boolean;
}

export function LoginForm({ next, notice, initialMethod = "password", googleEnabled }: LoginFormProps) {
  const router = useRouter();
  const [method, setMethod] = useState<Method>(initialMethod);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);

  const passwordAction = useServerAction(signInWithPassword);
  const linkAction = useServerAction(sendSignInLink);
  const action = method === "password" ? passwordAction : linkAction;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (method === "password") {
      const result = await passwordAction.run({ email, password, next });
      if (result.ok) {
        setRedirecting(true);
        router.replace(result.data.redirectTo);
        router.refresh();
      }
      return;
    }
    const result = await linkAction.run({ email, next });
    if (result.ok) setSentTo(email.trim());
  }

  if (sentTo) {
    return (
      <EmailSentPanel
        email={sentTo}
        title="Check your inbox."
        body="If there’s an account for this address, a sign-in link is on its way. It works once and expires in an hour."
        onBack={() => setSentTo(null)}
      />
    );
  }

  const signupHref = next !== routes.home ? `${routes.signup}?next=${encodeURIComponent(next)}` : routes.signup;

  return (
    <div className="animate-rise">
      <AuthHeading title="Welcome back.">Sign in to pick up where your team left off.</AuthHeading>

      {googleEnabled ? (
        <>
          <GoogleButton next={next} />
          <AuthDivider />
        </>
      ) : null}

      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <Segmented<Method>
          label="Sign-in method"
          value={method}
          onChange={(value) => {
            setMethod(value);
            passwordAction.reset();
            linkAction.reset();
          }}
          options={[
            { value: "password", label: "Password" },
            { value: "link", label: "Email me a link" },
          ]}
          className="self-start"
        />

        <FormError message={action.error ?? notice} />

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

        {method === "password" ? (
          <Field
            label="Password"
            htmlFor="password"
            error={passwordAction.fieldErrors.password}
            aside={
              <Link href={routes.forgotPassword} className="text-[13px] text-ink-3 transition-colors hover:text-ink">
                Forgot password?
              </Link>
            }
          >
            <PasswordInput
              id="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-invalid={Boolean(passwordAction.fieldErrors.password)}
            />
          </Field>
        ) : (
          <p className="text-[13px] leading-relaxed text-ink-3">
            We’ll email you a one-time link. No password needed.
          </p>
        )}

        <Button type="submit" size="lg" className="mt-2 w-full" loading={action.pending || redirecting}>
          {method === "password" ? "Sign in" : "Send sign-in link"}
        </Button>
      </form>

      <p className="mt-8 text-sm text-ink-3">
        New to maeosan?{" "}
        <Link href={signupHref} className="font-medium text-ink underline decoration-line-2 underline-offset-4 hover:decoration-ink">
          Create an account
        </Link>
      </p>
    </div>
  );
}
