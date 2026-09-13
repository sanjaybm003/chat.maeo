import { colorFromSeed, personColorStyle } from "@/lib/colors";
import { cn } from "@/lib/utils";

const SIZES = {
  sm: "size-7 rounded-[9px] text-[13px]",
  md: "size-9 rounded-[11px] text-[16px]",
  lg: "size-12 rounded-[15px] text-[21px]",
} as const;

/** A workspace is a place, so it gets a tile, while people get circles. */
export function WorkspaceGlyph({
  name,
  seed,
  size = "md",
  className,
}: {
  name: string;
  seed: string;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const letter = Array.from(name.trim())[0]?.toUpperCase() ?? "?";
  return (
    <span
      className={cn(
        "inline-flex shrink-0 select-none items-center justify-center bg-person font-display font-bold leading-none text-person-on",
        SIZES[size],
        className,
      )}
      style={personColorStyle(colorFromSeed(seed))}
      aria-hidden="true"
    >
      {letter}
    </span>
  );
}
