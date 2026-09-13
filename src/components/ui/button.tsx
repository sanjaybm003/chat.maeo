import { Slot } from "radix-ui";
import type { ComponentProps } from "react";

import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

const base =
  "relative inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-full font-medium " +
  "transition-[background-color,border-color,color,box-shadow,transform] duration-150 active:translate-y-px " +
  "disabled:pointer-events-none disabled:opacity-45 data-[loading]:pointer-events-none";

const variants = {
  primary: "bg-ink text-paper hover:bg-ink-2",
  accent: "bg-accent text-accent-ink hover:brightness-[0.95]",
  secondary: "border border-line-2 bg-surface text-ink hover:border-ink-4 hover:bg-surface-2",
  ghost: "text-ink-2 hover:bg-paper-2 hover:text-ink data-[state=open]:bg-paper-2 data-[state=open]:text-ink",
  danger: "bg-danger text-white hover:brightness-[0.94]",
  "danger-ghost": "text-danger hover:bg-danger-tint",
} as const;

const sizes = {
  sm: "h-8 gap-1.5 px-3.5 text-[13px]",
  md: "h-10 gap-2 px-4.5 text-sm",
  lg: "h-12 gap-2 px-6 text-[15px]",
  icon: "size-9",
  "icon-sm": "size-8",
} as const;

export type ButtonVariant = keyof typeof variants;
export type ButtonSize = keyof typeof sizes;

export interface ButtonProps extends ComponentProps<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  asChild?: boolean;
}

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  asChild = false,
  className,
  children,
  disabled,
  type,
  ...props
}: ButtonProps) {
  const classes = cn(base, variants[variant], sizes[size], className);

  if (asChild) {
    return (
      <Slot.Root className={classes} {...props}>
        {children}
      </Slot.Root>
    );
  }

  return (
    <button
      type={type ?? "button"}
      className={classes}
      disabled={disabled || loading}
      data-loading={loading || undefined}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <>
          <span className="invisible inline-flex items-center gap-[inherit]">{children}</span>
          <span className="absolute inset-0 flex items-center justify-center">
            <Spinner size={size === "sm" || size === "icon-sm" ? 14 : 16} />
          </span>
        </>
      ) : (
        children
      )}
    </button>
  );
}
