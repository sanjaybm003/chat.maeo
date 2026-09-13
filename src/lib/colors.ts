import type { CSSProperties } from "react";

import { PERSON_COLORS, type PersonColor } from "@/types/domain";

export const PERSON_COLOR_LABELS: Record<PersonColor, string> = {
  tomato: "Tomato",
  saffron: "Saffron",
  grass: "Grass",
  lagoon: "Lagoon",
  cobalt: "Cobalt",
  iris: "Iris",
  bubblegum: "Bubblegum",
  clay: "Clay",
};

export function toPersonColor(value: string | null | undefined): PersonColor {
  return PERSON_COLORS.includes(value as PersonColor) ? (value as PersonColor) : "cobalt";
}

/** Stable color for things without an owner, like a workspace or a group. */
export function colorFromSeed(seed: string): PersonColor {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) | 0;
  }
  return PERSON_COLORS[Math.abs(hash) % PERSON_COLORS.length];
}

/**
 * Exposes a person's palette to CSS as --person, --person-tint, --person-ink
 * and --person-on, so components style themselves without knowing the color.
 */
export function personColorStyle(color: PersonColor): CSSProperties {
  return {
    "--person": `var(--${color})`,
    "--person-tint": `var(--${color}-tint)`,
    "--person-ink": `var(--${color}-ink)`,
    "--person-on": `var(--${color}-on)`,
  } as CSSProperties;
}
