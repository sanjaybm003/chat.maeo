"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { IconArrowLeft } from "@/components/ui/icons";
import { useWorkspace } from "@/features/workspace/store/workspace-provider";
import { routes, type SettingsSection as SectionKey } from "@/lib/routes";
import { cn } from "@/lib/utils";

const SECTIONS: Array<{ key: SectionKey; label: string }> = [
  { key: "profile", label: "Profile" },
  { key: "preferences", label: "Preferences" },
  { key: "workspace", label: "Workspace" },
  { key: "ai", label: "AI credits" },
  { key: "integrations", label: "Connected apps" },
  { key: "account", label: "Account" },
];

export function SettingsChrome({ children }: { children: ReactNode }) {
  const slug = useWorkspace((state) => state.workspace.slug);
  const pathname = usePathname();

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-[900px] px-5 pb-24 pt-5 sm:px-10 sm:pt-10">
        <Link
          href={routes.workspace(slug)}
          className="mb-4 inline-flex size-9 items-center justify-center rounded-full text-ink-2 hover:bg-paper-2 md:hidden"
          aria-label="Back to chats"
        >
          <IconArrowLeft />
        </Link>
        <h1 className="font-display text-[44px] font-semibold leading-none tracking-[-0.04em]">Settings</h1>

        <nav className="mt-8 flex gap-1 overflow-x-auto border-b border-line" aria-label="Settings sections">
          {SECTIONS.map((section) => {
            const href = routes.settings(slug, section.key);
            const active = pathname === href;
            return (
              <Link
                key={section.key}
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "relative flex h-11 shrink-0 items-center px-3 text-[14px] transition-colors",
                  active
                    ? "font-medium text-ink after:absolute after:inset-x-3 after:-bottom-px after:h-[2px] after:rounded-full after:bg-ink"
                    : "text-ink-3 hover:text-ink",
                )}
              >
                {section.label}
              </Link>
            );
          })}
        </nav>

        <div className="pt-10">{children}</div>
      </div>
    </div>
  );
}

export function SettingsSection({
  title,
  description,
  tone,
  children,
}: {
  title: string;
  description?: ReactNode;
  tone?: "danger";
  children: ReactNode;
}) {
  return (
    <section className="grid gap-5 border-b border-line py-10 first:pt-0 last:border-b-0 md:grid-cols-[230px_minmax(0,1fr)] md:gap-12">
      <div>
        <h2 className={cn("font-display text-[19px] font-semibold tracking-[-0.01em]", tone === "danger" && "text-danger")}>{title}</h2>
        {description ? <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-3">{description}</p> : null}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

export function SettingRow({
  title,
  description,
  control,
}: {
  title: string;
  description?: ReactNode;
  control: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-line py-4 first:pt-0 last:border-b-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-[14.5px] font-medium text-ink">{title}</p>
        {description ? <p className="mt-0.5 text-[13px] leading-relaxed text-ink-3">{description}</p> : null}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}
