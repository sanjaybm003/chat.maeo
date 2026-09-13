"use client";

import { Dialog as DialogPrimitive } from "radix-ui";
import type { ComponentProps, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { IconClose } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;

interface DialogContentProps extends Omit<ComponentProps<typeof DialogPrimitive.Content>, "title"> {
  title: ReactNode;
  description?: ReactNode;
  hideClose?: boolean;
  width?: "sm" | "md" | "lg";
}

export function DialogContent({
  title,
  description,
  hideClose,
  width = "md",
  className,
  children,
  ...props
}: DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[#191713]/45 data-[state=open]:animate-fade-in" />
      <DialogPrimitive.Content
        className={cn(
          "fixed left-1/2 top-[max(1rem,10vh)] z-50 flex max-h-[min(84vh,760px)] w-[calc(100vw-1.5rem)] -translate-x-1/2 flex-col",
          "overflow-hidden rounded-[24px] border border-line bg-surface shadow-pop outline-none data-[state=open]:animate-pop-in",
          { sm: "max-w-[400px]", md: "max-w-[500px]", lg: "max-w-[640px]" }[width],
          className,
        )}
        {...props}
      >
        <div className="flex items-start justify-between gap-4 px-6 pt-6">
          <div className="min-w-0">
            <DialogPrimitive.Title className="font-display text-[22px] font-semibold leading-tight tracking-[-0.02em] text-ink">
              {title}
            </DialogPrimitive.Title>
            {description ? (
              <DialogPrimitive.Description className="mt-1.5 text-sm text-ink-3">{description}</DialogPrimitive.Description>
            ) : (
              <DialogPrimitive.Description className="sr-only">{typeof title === "string" ? title : "Dialog"}</DialogPrimitive.Description>
            )}
          </div>
          {hideClose ? null : (
            <DialogPrimitive.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Close" className="-mr-2 -mt-1">
                <IconClose />
              </Button>
            </DialogPrimitive.Close>
          )}
        </div>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogBody({ className, ...props }: ComponentProps<"div">) {
  return <div className={cn("min-h-0 flex-1 overflow-y-auto px-6 pb-2 pt-5", className)} {...props} />;
}

export function DialogFooter({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("flex flex-col-reverse gap-2 px-6 pb-6 pt-4 sm:flex-row sm:items-center sm:justify-end", className)}
      {...props}
    />
  );
}
