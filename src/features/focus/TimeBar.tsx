import type { FocusState } from "../../lib/types";
import { cn } from "../../lib/utils";
import { clockLabel, elapsedFraction, timeColor } from "./timer";

/** Slim progress bar of the current phase; fills as time passes. */
export function TimeBar({ state, className }: { state: FocusState; className?: string }) {
  const frac = elapsedFraction(state);
  return (
    <div
      role="progressbar"
      aria-label={clockLabel(state)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(frac * 100)}
      className={cn("h-1 w-full shrink-0 overflow-hidden rounded-[2px] bg-fill-active", className)}
    >
      <div
        className="h-full rounded-[2px] transition-[width,background-color] duration-1000 ease-linear"
        style={{ width: `${frac * 100}%`, background: timeColor(state) }}
      />
    </div>
  );
}
