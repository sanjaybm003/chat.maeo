import type { Metadata } from "next";
import type { ReactNode } from "react";

import { Logo } from "@/components/brand/logo";
import { signOut } from "@/features/auth/actions";
import { requireAuthUser } from "@/server/session";

export const metadata: Metadata = { title: "Set up" };

export default async function OnboardingLayout({ children }: { children: ReactNode }) {
  const user = await requireAuthUser("/onboarding");

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center justify-between gap-4 px-6 py-5 sm:px-10">
        <Logo />
        <div className="flex min-w-0 items-center gap-4">
          <span className="hidden truncate font-mono text-[12px] text-ink-3 sm:block">{user.email}</span>
          <form action={signOut}>
            <button type="submit" className="rounded-full px-3 py-1.5 text-sm text-ink-3 transition-colors hover:bg-paper-2 hover:text-ink">
              Sign out
            </button>
          </form>
        </div>
      </header>
      <main className="flex flex-1 px-6 pb-20 sm:px-10">{children}</main>
    </div>
  );
}
