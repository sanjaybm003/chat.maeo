"use client";

import type { ReactNode } from "react";

import { Button, type ButtonProps } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/tooltip";

interface IconButtonProps extends Omit<ButtonProps, "children" | "size"> {
  label: string;
  shortcut?: string;
  size?: "icon" | "icon-sm";
  tooltipSide?: "top" | "right" | "bottom" | "left";
  children: ReactNode;
}

export function IconButton({
  label,
  shortcut,
  size = "icon",
  variant = "ghost",
  tooltipSide,
  children,
  ...props
}: IconButtonProps) {
  return (
    <Tooltip label={label} shortcut={shortcut} side={tooltipSide}>
      <Button variant={variant} size={size} aria-label={label} {...props}>
        {children}
      </Button>
    </Tooltip>
  );
}
