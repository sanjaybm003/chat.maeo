"use client";

import { useRouter } from "next/navigation";
import { useSyncExternalStore } from "react";

import { routes } from "@/lib/routes";

import { resendConfirmation } from "../actions";
import { EmailSentPanel } from "./email-sent-panel";

export const PENDING_EMAIL_KEY = "maeosan:pending-email";

function readPendingEmail() {
  try {
    return sessionStorage.getItem(PENDING_EMAIL_KEY);
  } catch {
    return null;
  }
}

const noopSubscribe = () => () => {};

export function CheckEmailView() {
  const router = useRouter();
  const email = useSyncExternalStore(noopSubscribe, readPendingEmail, () => null);

  return (
    <EmailSentPanel
      email={email ?? "your inbox"}
      title="Confirm your email."
      body="We sent you a link to confirm it’s really you. Open it on this device and you’ll land straight in setup."
      backLabel="Back to sign up"
      onBack={() => router.push(routes.signup)}
      onResend={email ? () => resendConfirmation({ email }) : undefined}
    />
  );
}
