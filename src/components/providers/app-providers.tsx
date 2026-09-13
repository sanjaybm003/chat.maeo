"use client";

import type { ReactNode } from "react";

import { ThemeSync } from "@/components/providers/theme-sync";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthHashForwarder } from "@/features/auth/components/auth-hash-forwarder";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={350} skipDelayDuration={150}>
      <ThemeSync />
      <AuthHashForwarder />
      {children}
      <Toaster />
    </TooltipProvider>
  );
}
