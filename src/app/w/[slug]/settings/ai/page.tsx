import type { Metadata } from "next";

import { CreditsSettings } from "@/features/ai/components/credits-settings";

export const metadata: Metadata = { title: "AI credits" };

export default function AiCreditsSettingsPage() {
  return <CreditsSettings />;
}
