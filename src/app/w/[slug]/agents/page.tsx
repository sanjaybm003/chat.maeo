import type { Metadata } from "next";

import { AgentsScreen } from "@/features/ai/components/agents-screen";

export const metadata: Metadata = { title: "Agents" };

export default function AgentsPage() {
  return <AgentsScreen />;
}
