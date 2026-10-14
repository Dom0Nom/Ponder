import * as Popover from "@radix-ui/react-popover";
import { forwardRef, type ButtonHTMLAttributes, type CSSProperties } from "react";
import { Coffee, Pause, Timer } from "lucide-react";
import { Kbd } from "../../components/ui/misc";
import { s } from "../../lib/strings";
import type { FocusState } from "../../lib/types";
import { useUi } from "../../stores/ui";
import { ParkingInput, SessionControls } from "./controls";
import { useFocusStore } from "./focusStore";
import { TimeBar } from "./TimeBar";
import { clockLabel, clockText, elapsedFraction, phaseLabel } from "./timer";

function PhaseIcon({ state, size = 15 }: { state: FocusState; size?: number }) {
  if (state.paused) return <Pause size={size} />;
  if (state.phase === "break" || state.phase === "longBreak") return <Coffee size={size} />;
  return <Timer size={size} />;
}

const triggerClass = "flex h-7 items-center gap-2.5 rounded-btn px-2.5 hover:bg-fill-active";

const CompactTimer = forwardRef<HTMLButtonElement, { state: FocusState } & ButtonHTMLAttributes<HTMLButtonElement>>(function CompactTimer(
  { state, onClick, ...rest },
  ref,
) {
  const pct = elapsedFraction(state) * 100;
  return (
    <button ref={ref} {...rest} aria-label={`${phaseLabel(state)}, ${clockLabel(state)}`} className={triggerClass} onClick={onClick}>
      <span dir="ltr" className="text-body-lg font-semibold tabular-nums">{clockText(state)}</span>
      <span
        className="relative size-4 rounded-full"
        style={{ background: `conic-gradient(var(--primary) 0 ${pct}%, var(--timer-track) ${pct}% 100%)` }}
      >
        <span className="absolute inset-[3px] rounded-full bg-chrome" />
      </span>
    </button>
  );
});

/** Compact timer in the header while a focus session runs. */
export function FocusHeaderTimer() {
  const state = useFocusStore((st) => st.state);
  const route = useUi((st) => st.route);
  const studioOpen = useUi((st) => st.studioOpen);
  const toggleStudio = useUi((st) => st.toggleStudio);

  if (!state) return null;

  if (route.name === "space") {
    if (studioOpen) return null;
    return (
      <div className="t-panel-slide" data-open="true" style={{ "--panel-translate-y": "0px" } as CSSProperties}>
        <CompactTimer state={state} onClick={toggleStudio} />
      </div>
    );
  }

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <CompactTimer state={state} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="t-dropdown z-50 w-80 rounded-card border border-border bg-surface p-4 shadow-popover outline-none"
        >
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <p className="flex items-center gap-1.5 text-body font-semibold">
              <PhaseIcon state={state} size={14} /> {phaseLabel(state)}
              <span className="font-normal text-faint">· {s.focus.block(state.block)}</span>
            </p>
            <p dir="ltr" className="text-title font-semibold tabular-nums">{clockText(state)}</p>
          </div>
          <TimeBar state={state} className="mb-3" />
          {state.goal && <p className="mb-3 text-body text-muted">{state.goal}</p>}
          <SessionControls state={state} />
          <div className="mt-4 border-t border-border pt-3">
            <p className="mb-1.5 flex items-center justify-between text-label font-medium text-muted">
              {s.focus.parking} <Kbd>{s.focus.parkingShortcut}</Kbd>
            </p>
            <ParkingInput />
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
