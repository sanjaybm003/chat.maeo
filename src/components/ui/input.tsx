import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

export const inputStyles =
  "w-full rounded-xl border border-line-2 bg-surface px-3.5 text-[15px] text-ink placeholder:text-ink-4 " +
  "transition-[border-color,box-shadow] duration-150 outline-none " +
  "hover:border-ink-4 focus:border-ink focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--ink)_8%,transparent)] " +
  "disabled:cursor-not-allowed disabled:opacity-60 " +
  "aria-[invalid=true]:border-danger aria-[invalid=true]:focus:shadow-[0_0_0_4px_color-mix(in_srgb,var(--danger)_14%,transparent)]";

export function Input({ className, type = "text", ...props }: ComponentProps<"input">) {
  return <input type={type} className={cn(inputStyles, "h-11", className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={cn(inputStyles, "min-h-24 resize-none py-2.5 leading-relaxed", className)} {...props} />;
}
