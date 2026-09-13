import type { ReactElement } from "react";

import { cn } from "@/lib/utils";

/**
 * A seeded Bauhaus tile field: quarter circles, half moons, bars and dots in
 * flat person colors. Deterministic, so server and client render the same art.
 */

const BACKGROUNDS = ["tomato", "saffron", "grass", "lagoon", "cobalt", "iris", "bubblegum", "ink", "paper-3"] as const;
const FOREGROUNDS = ["tomato", "saffron", "grass", "cobalt", "iris", "bubblegum", "paper", "ink", "lagoon"] as const;

type Swatch = (typeof BACKGROUNDS)[number] | (typeof FOREGROUNDS)[number];

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const fill = (swatch: Swatch) => ({ fill: `var(--${swatch})` });

function tileShape(kind: number, rotation: number, fg: Swatch, alt: Swatch): ReactElement {
  const r = `rotate(${rotation * 90} 50 50)`;
  switch (kind) {
    case 0:
      return <path d="M0 100V0a100 100 0 0 1 100 100Z" transform={r} style={fill(fg)} />;
    case 1:
      return <path d="M0 50a50 50 0 0 1 100 0Z" transform={r} style={fill(fg)} />;
    case 2:
      return <circle cx="50" cy="50" r="34" style={fill(fg)} />;
    case 3:
      return (
        <g>
          <circle cx="50" cy="50" r="40" style={fill(fg)} />
          <circle cx="50" cy="50" r="16" style={fill(alt)} />
        </g>
      );
    case 4:
      return <path d="M0 0h100L0 100Z" transform={r} style={fill(fg)} />;
    case 5:
      return (
        <g transform={r}>
          <rect x="0" y="14" width="100" height="14" style={fill(fg)} />
          <rect x="0" y="43" width="100" height="14" style={fill(fg)} />
          <rect x="0" y="72" width="100" height="14" style={fill(fg)} />
        </g>
      );
    case 6:
      return (
        <g>
          {[20, 50, 80].flatMap((cx) =>
            [20, 50, 80].map((cy) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="7" style={fill(fg)} />),
          )}
        </g>
      );
    case 7:
      return (
        <g transform={r}>
          <path d="M0 0h50a50 50 0 0 1-50 50Z" style={fill(fg)} />
          <path d="M100 100H50a50 50 0 0 1 50-50Z" style={fill(alt)} />
        </g>
      );
    default:
      return <rect x="25" y="25" width="50" height="50" rx="25" transform={r} style={fill(fg)} />;
  }
}

interface MosaicProps {
  cols: number;
  rows: number;
  seed?: number;
  className?: string;
}

export function Mosaic({ cols, rows, seed = 7, className }: MosaicProps) {
  const random = mulberry32(seed);
  const pick = <T,>(list: readonly T[]) => list[Math.floor(random() * list.length)];
  const tiles: ReactElement[] = [];

  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const bg = pick(BACKGROUNDS);
      const fg = pick(FOREGROUNDS.filter((c) => c !== bg && !(bg === "paper-3" && c === "paper")));
      const alt = pick(FOREGROUNDS.filter((c) => c !== fg && c !== bg));
      const kind = Math.floor(random() * 9);
      const rotation = Math.floor(random() * 4);
      tiles.push(
        <g key={`${x}-${y}`} transform={`translate(${x * 100} ${y * 100})`}>
          <rect width="100" height="100" style={fill(bg)} />
          {tileShape(kind, rotation, fg, alt)}
        </g>,
      );
    }
  }

  return (
    <svg
      viewBox={`0 0 ${cols * 100} ${rows * 100}`}
      preserveAspectRatio="xMidYMid slice"
      className={cn("block", className)}
      aria-hidden="true"
    >
      {tiles}
    </svg>
  );
}
