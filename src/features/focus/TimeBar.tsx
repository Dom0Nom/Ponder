import type { ReactNode } from "react";
import type { FocusState } from "../../lib/types";
import { cn } from "../../lib/utils";
import { clockLabel, timeColor, timeFraction } from "./timer";

function wedgePath(c: number, r: number, frac: number): string {
  if (frac <= 0) return "";
  if (frac >= 0.9999) return `M ${c} ${c - r} A ${r} ${r} 0 1 1 ${c - 0.01} ${c - r} Z`;
  const a = frac * 2 * Math.PI;
  const x = c + r * Math.sin(a);
  const y = c - r * Math.cos(a);
  return `M ${c} ${c} L ${c} ${c - r} A ${r} ${r} 0 ${frac > 0.5 ? 1 : 0} 1 ${x} ${y} Z`;
}

/**
 * Time Timer–style indicator of the current phase: a ring (with a soft disc inside when large)
 * that shrinks as time runs out, or a slim bar.
 */
export function TimeBar({
  state,
  variant = "ring",
  size = 160,
  className,
  children,
}: {
  state: FocusState;
  variant?: "ring" | "bar";
  size?: number;
  className?: string;
  children?: ReactNode;
}) {
  const frac = timeFraction(state);
  const color = timeColor(state);

  if (variant === "bar") {
    return (
      <div
        role="progressbar"
        aria-label={clockLabel(state)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(frac * 100)}
        className={cn("h-1.5 w-full overflow-hidden rounded-full bg-timer-track", className)}
      >
        <div
          className="h-full rounded-full transition-[width,background-color] duration-1000 ease-linear"
          style={{ width: `${frac * 100}%`, background: color }}
        />
      </div>
    );
  }

  const stroke = Math.max(3, Math.round(size * 0.07));
  const c = size / 2;
  const r = c - stroke / 2;
  const circ = 2 * Math.PI * r;
  const showDisc = size >= 120;
  return (
    <div
      role="img"
      aria-label={clockLabel(state)}
      className={cn("relative inline-flex shrink-0 items-center justify-center", className)}
      style={{ width: size, height: size }}
    >
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="absolute inset-0">
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--timer-track)" strokeWidth={stroke} />
        {showDisc && <path d={wedgePath(c, r - stroke, frac)} fill={color} opacity={0.12} />}
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeLinecap={frac > 0.002 ? "round" : "butt"}
          strokeDasharray={circ}
          strokeDashoffset={circ * (1 - frac)}
          transform={`rotate(-90 ${c} ${c})`}
          className="transition-[stroke-dashoffset,stroke] duration-1000 ease-linear"
        />
      </svg>
      {children && <div className="relative flex flex-col items-center text-center">{children}</div>}
    </div>
  );
}
