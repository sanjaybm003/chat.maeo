import type { Metadata } from "next";

import { SignupForm } from "@/features/auth/components/signup-form";
import { env } from "@/lib/env";
import { routes, safeNextPath } from "@/lib/routes";

export const metadata: Metadata = { title: "Create your account" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === "string" ? params.next : null, routes.onboarding.profile);

  return <SignupForm next={next} googleEnabled={env.googleAuthEnabled} invited={next.startsWith("/invite/")} />;
}
