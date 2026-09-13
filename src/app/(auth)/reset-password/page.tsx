import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { ResetPasswordForm } from "@/features/auth/components/reset-password-form";
import { routes } from "@/lib/routes";
import { getAuthUser } from "@/server/session";

export const metadata: Metadata = { title: "Choose a new password" };

export default async function ResetPasswordPage() {
  const user = await getAuthUser();
  if (!user) redirect(`${routes.login}?error=link`);

  return <ResetPasswordForm email={user.email ?? ""} />;
}
