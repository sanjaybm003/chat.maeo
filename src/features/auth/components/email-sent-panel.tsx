"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";

interface EmailSentPanelProps {
  email: string;
  title: string;
  body: string;
  onBack?: () => void;
  backLabel?: string;
  onResend?: () => Promise<{ ok: boolean; error?: string }>;
}

const RESEND_COOLDOWN_SECONDS = 60;

export function EmailSentPanel({ email, title, body, onBack, backLabel = "Use a different email", onResend }: EmailSentPanelProps) {
  const [cooldown, setCooldown] = useState(RESEND_COOLDOWN_SECONDS);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  async function resend() {
    if (!onResend) return;
    setSending(true);
    const result = await onResend();
    setSending(false);
    if (result.ok) {
      toast.success("Sent again. Give it a minute.");
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } else {
      toast.error(result.error ?? "Couldn't resend the email.");
    }
  }

  return (
    <div className="animate-rise">
      <Envelope />
      <h1 className="mt-8 font-display text-[40px] font-semibold leading-[1.02] tracking-[-0.035em]">{title}</h1>
      <p className="mt-3 text-[15px] leading-relaxed text-ink-3">{body}</p>
      <p className="mt-5 inline-flex max-w-full items-center rounded-full border border-line bg-surface px-3.5 py-1.5 font-mono text-[13px] text-ink">
        <span className="truncate">{email}</span>
      </p>
      <div className="mt-8 flex flex-wrap items-center gap-2">
        {onResend ? (
          <Button variant="secondary" onClick={resend} loading={sending} disabled={cooldown > 0}>
            {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend email"}
          </Button>
        ) : null}
        {onBack ? (
          <Button variant="ghost" onClick={onBack}>
            {backLabel}
          </Button>
        ) : null}
      </div>
    </div>
  );
}

/** A flat, geometric envelope in brand colors. */
function Envelope() {
  return (
    <svg viewBox="0 0 96 72" width="96" height="72" aria-hidden="true">
      <rect x="0" y="0" width="96" height="72" rx="14" style={{ fill: "var(--cobalt)" }} />
      <path d="M0 14 48 44 96 14V0H0Z" style={{ fill: "var(--saffron)" }} />
      <circle cx="78" cy="56" r="8" style={{ fill: "var(--tomato)" }} />
    </svg>
  );
}
