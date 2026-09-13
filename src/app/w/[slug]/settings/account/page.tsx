import type { Metadata } from "next";

import { AccountSettings } from "@/features/settings/components/account-settings";
import { requireAuthUser } from "@/server/session";

export const metadata: Metadata = { title: "Account" };

export default async function AccountSettingsPage() {
  const user = await requireAuthUser();
  const provider = typeof user.app_metadata?.provider === "string" ? user.app_metadata.provider : "email";

  return <AccountSettings email={user.email ?? ""} provider={provider} />;
}
