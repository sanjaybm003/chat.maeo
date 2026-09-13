import Link from "next/link";

import { Logo } from "@/components/brand/logo";
import { Mosaic } from "@/components/brand/mosaic";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-10 px-6 py-16 text-center">
      <Logo />
      <div className="size-40 overflow-hidden rounded-[32px]">
        <Mosaic cols={2} rows={2} seed={404} className="size-full" />
      </div>
      <div className="max-w-sm">
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-ink-3">Error 404</p>
        <h1 className="mt-3 font-display text-4xl font-semibold tracking-[-0.03em]">Nobody’s here.</h1>
        <p className="mt-3 text-ink-3">
          This page moved, or you don’t have access to it. Head back and pick up the conversation.
        </p>
      </div>
      <Button asChild size="lg">
        <Link href="/">Back to maeosan</Link>
      </Button>
    </main>
  );
}
