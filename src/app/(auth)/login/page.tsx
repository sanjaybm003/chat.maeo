import type { Metadata } from "next";

import { LoginForm } from "@/features/auth/components/login-form";
import { authNotice, initialSignInMethod } from "@/features/auth/notices";
import { env } from "@/lib/env";
import { safeNextPath } from "@/lib/routes";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const next = safeNextPath(typeof params.next === "string" ? params.next : null);

  return (
    <LoginForm
      next={next}
      notice={authNotice(params.error)}
      initialMethod={initialSignInMethod(params.error)}
      googleEnabled={env.googleAuthEnabled}
    />
  );
}
