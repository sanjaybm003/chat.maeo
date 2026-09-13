"use client";

import { DropdownMenu } from "radix-ui";
import { cloneElement, isValidElement, type ComponentProps, type ReactNode } from "react";

import { cn } from "@/lib/utils";

export const Menu = DropdownMenu.Root;
export const MenuTrigger = DropdownMenu.Trigger;
export const MenuGroup = DropdownMenu.Group;
export const MenuRadioGroup = DropdownMenu.RadioGroup;

export function MenuContent({
  className,
  sideOffset = 6,
  align = "start",
  ...props
}: ComponentProps<typeof DropdownMenu.Content>) {
  return (
    <DropdownMenu.Portal>
      <DropdownMenu.Content
        sideOffset={sideOffset}
        align={align}
        collisionPadding={12}
        className={cn(
          "z-50 min-w-[220px] overflow-hidden rounded-2xl border border-line bg-surface p-1.5 shadow-pop outline-none",
          "data-[state=open]:animate-pop-in",
          className,
        )}
        {...props}
      />
    </DropdownMenu.Portal>
  );
}

interface MenuItemProps extends ComponentProps<typeof DropdownMenu.Item> {
  icon?: ReactNode;
  shortcut?: string;
  tone?: "default" | "danger";
}

export function MenuItem({ className, icon, shortcut, tone = "default", asChild, children, ...props }: MenuItemProps) {
  const classes = cn(
    "flex h-9 cursor-pointer select-none items-center gap-2.5 rounded-xl px-2.5 text-sm outline-none",
    "data-[disabled]:pointer-events-none data-[disabled]:opacity-45",
    tone === "danger" ? "text-danger data-[highlighted]:bg-danger-tint" : "text-ink data-[highlighted]:bg-paper-2",
    className,
  );

  const layout = (label: ReactNode) => (
    <>
      {icon ? <span className="flex size-4.5 items-center justify-center text-ink-3">{icon}</span> : null}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {shortcut ? <span className="font-mono text-[11px] text-ink-4">{shortcut}</span> : null}
    </>
  );

  // Radix slots onto exactly one element. A link item therefore receives the
  // icon and label layout as its own children instead of as siblings.
  if (asChild && isValidElement<{ className?: string; children?: ReactNode }>(children)) {
    return (
      <DropdownMenu.Item asChild {...props}>
        {cloneElement(children, { className: cn(classes, children.props.className) }, layout(children.props.children))}
      </DropdownMenu.Item>
    );
  }

  return (
    <DropdownMenu.Item className={classes} {...props}>
      {layout(children)}
    </DropdownMenu.Item>
  );
}

export function MenuRadioItem({ className, children, ...props }: ComponentProps<typeof DropdownMenu.RadioItem>) {
  return (
    <DropdownMenu.RadioItem
      className={cn(
        "flex h-9 cursor-pointer select-none items-center gap-2.5 rounded-xl px-2.5 text-sm text-ink outline-none data-[highlighted]:bg-paper-2",
        className,
      )}
      {...props}
    >
      <span className="flex size-4 items-center justify-center">
        <DropdownMenu.ItemIndicator>
          <span className="block size-2 rounded-full bg-ink" />
        </DropdownMenu.ItemIndicator>
      </span>
      {children}
    </DropdownMenu.RadioItem>
  );
}

export function MenuLabel({ className, ...props }: ComponentProps<typeof DropdownMenu.Label>) {
  return (
    <DropdownMenu.Label
      className={cn("px-2.5 pb-1 pt-2 font-mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3", className)}
      {...props}
    />
  );
}

export function MenuSeparator({ className, ...props }: ComponentProps<typeof DropdownMenu.Separator>) {
  return <DropdownMenu.Separator className={cn("-mx-1.5 my-1.5 h-px bg-line", className)} {...props} />;
}
