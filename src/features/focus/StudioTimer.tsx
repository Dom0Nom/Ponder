import { Coffee, Pause, Play } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Skeleton } from "../../components/ui/misc";
import { s } from "../../lib/strings";
import { cn, formatDuration } from "../../lib/utils";
import { useUi } from "../../stores/ui";
import { useFocusActions } from "./controls";
import { useFocusStore } from "./focusStore";
import { clockText } from "./timer";

const IDLE_MS = 25 * 60_000;

export function StudioTimer() {
  const state = useFocusStore((st) => st.state);
  const loaded = useFocusStore((st) => st.loaded);
  const setFocusDialogOpen = useUi((st) => st.setFocusDialogOpen);
  const setStudioView = useUi((st) => st.setStudioView);
  const { run, pending } = useFocusActions();

  if (!loaded)
    return (
      <div className="flex items-center justify-between gap-3 border-b border-divider p-4">
        <Skeleton className="h-14 w-40" />
        <Skeleton className="h-10 w-28 rounded-[8px]" />
      </div>
    );

  const isWork = state?.phase === "work";
  const needApp = !!state && !isWork && state.pauseReason === "needApp";
  const dim = !state || state.paused;

  return (
    <div className="flex shrink-0 items-center justify-between gap-3 border-b border-divider p-4">
      <button
        type="button"
        aria-label={s.focus.details}
        onClick={() => setStudioView("focus")}
        className={cn(
          "text-timer font-medium tabular-nums transition-opacity hover:opacity-80",
          dim && "opacity-40 hover:opacity-50",
        )}
      >
        {state ? clockText(state) : formatDuration(IDLE_MS)}
      </button>
      {!state ? (
        <Button variant="primary" className="h-10 w-28 rounded-pane" onClick={() => setFocusDialogOpen(true)}>
          <Play size={15} /> {s.focus.startShort}
        </Button>
      ) : isWork ? (
        <Button
          variant="primary"
          className="h-10 w-28 rounded-pane"
          disabled={!!pending}
          onClick={() => run(state.paused ? "resume" : "pause")}
        >
          {state.paused ? <Play size={15} /> : <Pause size={15} />} {state.paused ? s.focus.resume : s.focus.pause}
        </Button>
      ) : (
        needApp && (
          <Button variant="primary" className="h-10 w-28 rounded-pane px-0" disabled={!!pending} onClick={() => run("resume")}>
            <Coffee size={15} /> {s.focus.resumeBreak}
          </Button>
        )
      )}
    </div>
  );
}
