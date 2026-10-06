import * as Popover from "@radix-ui/react-popover";
import { Coffee, Pause, Timer } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Kbd, Tooltip } from "../../components/ui/misc";
import { s } from "../../lib/strings";
import type { FocusState } from "../../lib/types";
import { useUi } from "../../stores/ui";
import { ParkingInput, SessionControls } from "./controls";
import { useFocusStore } from "./focusStore";
import { TimeBar } from "./TimeBar";
import { clockLabel, clockText, phaseLabel } from "./timer";

function PhaseIcon({ state, size = 15 }: { state: FocusState; size?: number }) {
  if (state.paused) return <Pause size={size} />;
  if (state.phase === "break" || state.phase === "longBreak") return <Coffee size={size} />;
  return <Timer size={size} />;
}

/** Compact timer in the header; shows a start button when no session runs. */
export function FocusHeaderTimer() {
  const open = useUi((st) => st.setFocusDialogOpen);
  const state = useFocusStore((st) => st.state);

  if (!state) {
    return (
      <Tooltip content={<span>{s.focus.startTitle} <Kbd>{s.focus.shortcut}</Kbd></span>}>
        <Button variant="tonal" size="sm" onClick={() => open(true)}>
          <Timer size={15} /> {s.focus.start}
        </Button>
      </Tooltip>
    );
  }

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          aria-label={`${phaseLabel(state)}, ${clockLabel(state)}`}
          className="flex h-8 items-center gap-2 rounded-full bg-accent-soft pl-2.5 pr-3 text-[0.8125rem] font-medium text-accent-text transition-colors hover:brightness-95 dark:hover:brightness-110"
        >
          <PhaseIcon state={state} />
          <span className="tabular-nums">{clockText(state)}</span>
          <TimeBar state={state} variant="bar" className="w-10 bg-surface/70" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={8}
          className="z-50 w-80 rounded-[var(--radius-card)] border border-border bg-surface p-4 shadow-xl outline-none"
        >
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <PhaseIcon state={state} size={14} /> {phaseLabel(state)}
              <span className="font-normal text-faint">· {s.focus.block(state.block)}</span>
            </p>
            <p className="text-lg font-semibold tabular-nums">{clockText(state)}</p>
          </div>
          <TimeBar state={state} variant="bar" className="mb-3" />
          {state.goal && <p className="mb-3 text-[0.8125rem] text-muted">{state.goal}</p>}
          <SessionControls state={state} />
          <div className="mt-4 border-t border-border pt-3">
            <p className="mb-1.5 flex items-center justify-between text-xs font-medium text-muted">
              {s.focus.parking} <Kbd>{s.focus.parkingShortcut}</Kbd>
            </p>
            <ParkingInput />
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
