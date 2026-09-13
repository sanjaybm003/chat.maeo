"use client";

import { useEffect, useRef, useState } from "react";

import { cn, pluralize } from "@/lib/utils";

import { formatCredits } from "../credits";
import { dayLabel, niceCeiling, type DayUsage } from "../lib/usage";

const HEIGHT = 200;
const TOP = 14;
const BOTTOM = 26;
const LEFT = 46;
const MAX_BAR = 24;
const GAP = 2;

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/** A column whose top corners are rounded and whose base sits flat on the baseline. */
function columnPath(x: number, y: number, width: number, height: number) {
  const r = Math.min(4, width / 2, height);
  return `M${x} ${y + height}V${y + r}Q${x} ${y} ${x + r} ${y}H${x + width - r}Q${x + width} ${y} ${x + width} ${y + r}V${y + height}Z`;
}

/** Credits per day: one series, one hue, hairline grid, and a tooltip for the day under the pointer. */
export function UsageChart({ series }: { series: DayUsage[] }) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);

  const max = niceCeiling(Math.max(0, ...series.map((day) => day.credits)));
  const plotWidth = Math.max(0, width - LEFT);
  const plotHeight = HEIGHT - TOP - BOTTOM;
  const slot = series.length > 0 ? plotWidth / series.length : 0;
  const barWidth = Math.max(2, Math.min(MAX_BAR, slot - GAP));
  const ticks = [0, max / 2, max];
  const labelled = [...new Set([0, Math.floor((series.length - 1) / 2), series.length - 1])].filter((index) => index >= 0);
  const activeDay = active === null ? null : series[active];
  const tooltipLeft = active === null ? 0 : Math.min(Math.max(LEFT + active * slot + slot / 2, 72), Math.max(width - 72, 72));

  return (
    <div ref={ref} className="relative w-full select-none" style={{ height: HEIGHT }} onMouseLeave={() => setActive(null)}>
      {width > 0 ? (
        <svg width={width} height={HEIGHT} className="block" role="img" aria-label={`Credits used per day over the last ${series.length} days`}>
          {ticks.map((tick) => {
            const y = Math.round(TOP + plotHeight - (tick / max) * plotHeight) + 0.5;
            return (
              <g key={tick}>
                <line x1={LEFT} x2={width} y1={y} y2={y} className="stroke-line" strokeWidth={1} />
                <text x={LEFT - 10} y={y} dy="0.32em" textAnchor="end" className="fill-ink-2 font-mono text-[10.5px]">
                  {formatCredits(tick, { compactAbove: 10_000 })}
                </text>
              </g>
            );
          })}

          {series.map((day, index) => {
            const height = (day.credits / max) * plotHeight;
            const x = LEFT + index * slot + (slot - barWidth) / 2;
            return (
              <g key={day.day}>
                {height > 0 ? (
                  <path
                    d={columnPath(x, TOP + plotHeight - height, barWidth, Math.max(height, 1))}
                    className={cn("fill-meter transition-opacity duration-150", active !== null && active !== index && "opacity-35")}
                  />
                ) : null}
                <rect
                  x={LEFT + index * slot}
                  y={0}
                  width={slot}
                  height={HEIGHT}
                  fill="transparent"
                  onMouseEnter={() => setActive(index)}
                />
              </g>
            );
          })}

          {labelled.map((index) => (
            <text
              key={index}
              x={index === 0 ? LEFT : index === series.length - 1 ? width : LEFT + index * slot + slot / 2}
              y={HEIGHT - 7}
              textAnchor={index === 0 ? "start" : index === series.length - 1 ? "end" : "middle"}
              className="fill-ink-2 text-[11px]"
            >
              {dayLabel(series[index].day)}
            </text>
          ))}
        </svg>
      ) : null}

      {activeDay ? (
        <div
          className="pointer-events-none absolute top-0 z-10 -translate-x-1/2 rounded-xl border border-line bg-surface px-3 py-2 shadow-pop"
          style={{ left: tooltipLeft }}
        >
          <p className="whitespace-nowrap text-[12px] text-ink-2">{dayLabel(activeDay.day, "long")}</p>
          <p className="whitespace-nowrap font-display text-[17px] font-semibold text-ink">
            {formatCredits(activeDay.credits)} <span className="font-sans text-[12px] font-normal text-ink-2">credits</span>
          </p>
          <p className="text-[12px] text-ink-2">{pluralize(activeDay.runs, "run")}</p>
        </div>
      ) : null}
    </div>
  );
}

export function UsageTable({ series }: { series: DayUsage[] }) {
  const rows = [...series].reverse();
  return (
    <div className="max-h-[320px] overflow-y-auto rounded-2xl border border-line">
      <table className="w-full text-left text-[13px]">
        <thead className="sticky top-0 bg-surface">
          <tr className="border-b border-line-2 text-[12px] text-ink-2">
            <th className="px-3 py-2 font-medium">Day</th>
            <th className="px-3 py-2 text-right font-medium">Runs</th>
            <th className="px-3 py-2 text-right font-medium">Credits</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((day) => (
            <tr key={day.day} className="border-b border-line last:border-b-0">
              <td className="px-3 py-2 text-ink-2">{dayLabel(day.day, "long")}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-ink-2">{day.runs}</td>
              <td className="px-3 py-2 text-right font-mono tabular-nums text-ink">{formatCredits(day.credits)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
