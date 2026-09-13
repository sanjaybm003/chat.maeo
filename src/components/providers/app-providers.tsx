"use client";

import type { ReactNode } from "react";

import { ThemeSync } from "@/components/providers/theme-sync";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider delayDuration={350} skipDelayDuration={150}>
      <ThemeSync />
      {children}
      <Toaster />
    </TooltipProvider>
  );
}
