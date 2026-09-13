"use client";

import { Toaster as Sonner } from "sonner";

const Dot = ({ color }: { color: string }) => (
  <span className="block size-2.5 rounded-full" style={{ backgroundColor: `var(--${color})` }} />
);

export function Toaster() {
  return (
    <Sonner
      position="bottom-center"
      offset={20}
      gap={8}
      visibleToasts={3}
      icons={{
        success: <Dot color="grass" />,
        error: <Dot color="tomato" />,
        info: <Dot color="cobalt" />,
        warning: <Dot color="saffron" />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex w-[min(92vw,380px)] items-center gap-3 rounded-2xl bg-inverse px-4 py-3 text-[14px] text-inverse-ink shadow-pop",
          title: "font-medium leading-snug",
          description: "text-[13px] leading-snug opacity-70",
          icon: "flex shrink-0 items-center",
          actionButton:
            "ml-auto shrink-0 rounded-full bg-[color-mix(in_srgb,var(--inverse-ink)_16%,transparent)] px-3 py-1 text-[13px] font-medium",
          cancelButton: "shrink-0 rounded-full px-2 py-1 text-[13px] opacity-70",
        },
      }}
    />
  );
}
