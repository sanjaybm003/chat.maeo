import type { Metadata } from "next";
import type { ReactNode } from "react";

import { SettingsChrome } from "@/features/settings/components/settings-chrome";

export const metadata: Metadata = { title: "Settings" };

export default function SettingsLayout({ children }: { children: ReactNode }) {
  return <SettingsChrome>{children}</SettingsChrome>;
}
