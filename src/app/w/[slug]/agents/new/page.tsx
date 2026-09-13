import type { Metadata } from "next";

import { AgentBuilder } from "@/features/ai/components/agent-builder";

export const metadata: Metadata = { title: "New agent" };

export default async function NewAgentPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { prompt } = await searchParams;
  const initialPrompt = typeof prompt === "string" ? prompt.slice(0, 2000) : undefined;

  return <AgentBuilder key={initialPrompt ?? "blank"} initialPrompt={initialPrompt} />;
}
