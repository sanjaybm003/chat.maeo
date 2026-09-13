import type { Metadata } from "next";

import { PreferencesSettings } from "@/features/settings/components/preferences-settings";

export const metadata: Metadata = { title: "Preferences" };

export default function PreferencesSettingsPage() {
  return <PreferencesSettings />;
}
