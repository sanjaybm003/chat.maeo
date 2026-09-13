import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AgentBuilder } from "@/features/ai/components/agent-builder";

export const metadata: Metadata = { title: "Agent" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function AgentPage({ params }: { params: Promise<{ slug: string; agentId: string }> }) {
  const { agentId } = await params;
  if (!UUID.test(agentId)) notFound();

  return <AgentBuilder key={agentId} agentId={agentId} />;
}
