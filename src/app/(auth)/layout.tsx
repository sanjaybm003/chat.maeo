import Link from "next/link";
import type { ReactNode } from "react";

import { Logo } from "@/components/brand/logo";
import { Mosaic } from "@/components/brand/mosaic";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
      <div className="flex min-h-dvh flex-col px-6 py-6 sm:px-12">
        <header>
          <Link href="/" aria-label="maeosan home" className="inline-flex rounded-lg">
            <Logo />
          </Link>
        </header>
        <main className="flex flex-1 items-center py-12">
          <div className="mx-auto w-full max-w-[400px]">{children}</div>
        </main>
        <footer className="flex items-center justify-between font-mono text-[11px] uppercase tracking-[0.12em] text-ink-4">
          <span>maeosan</span>
          <span>Made for small teams</span>
        </footer>
      </div>

      <aside className="relative hidden overflow-hidden border-l border-line lg:block" aria-hidden="true">
        <Mosaic cols={6} rows={8} seed={31} className="absolute inset-0 size-full" />
        <div className="absolute inset-x-10 bottom-10 max-w-[460px] rounded-[28px] border border-line bg-paper p-8">
          <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">People, not channels</p>
          <p className="mt-4 font-display text-[36px] font-semibold leading-[1.02] tracking-[-0.035em] text-ink">
            Every conversation starts with a person.
          </p>
          <p className="mt-4 text-[15px] leading-relaxed text-ink-2">
            Your whole team as contacts. Tap a name, say the thing, get back to work.
          </p>
        </div>
      </aside>
    </div>
  );
}
