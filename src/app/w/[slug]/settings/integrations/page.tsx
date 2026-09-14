import type { Metadata } from "next";

import { IntegrationsSettings } from "@/features/integrations/components/integrations-settings";

export const metadata: Metadata = { title: "Connected apps" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? null;

export default async function IntegrationsSettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  return <IntegrationsSettings status={{ connected: first(params.connected), error: first(params.error), notice: first(params.notice) }} />;
}
