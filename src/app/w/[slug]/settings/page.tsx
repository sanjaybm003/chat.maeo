import { redirect } from "next/navigation";

import { routes } from "@/lib/routes";

export default async function SettingsIndexPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  redirect(routes.settings(slug, "profile"));
}
