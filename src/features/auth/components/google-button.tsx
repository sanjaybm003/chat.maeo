"use client";

import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { IconGoogle } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

import { startGoogleSignIn } from "../actions";

export function GoogleButton({ next, label = "Continue with Google", className }: { next?: string; label?: string; className?: string }) {
  const [pending, setPending] = useState(false);

  async function handleClick() {
    setPending(true);
    const result = await startGoogleSignIn(next);
    if (result.ok) {
      window.location.assign(result.data.url);
      return;
    }
    setPending(false);
    toast.error(result.error);
  }

  return (
    <Button variant="secondary" size="lg" className={cn("w-full", className)} onClick={handleClick} loading={pending}>
      <IconGoogle size={18} />
      {label}
    </Button>
  );
}

export function AuthDivider({ label = "or" }: { label?: string }) {
  return (
    <div className="my-6 flex items-center gap-3" role="separator">
      <span className="h-px flex-1 bg-line" />
      <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-4">{label}</span>
      <span className="h-px flex-1 bg-line" />
    </div>
  );
}
