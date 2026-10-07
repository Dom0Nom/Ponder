import { useQuery } from "@tanstack/react-query";
import { Coffee, Pause, Play } from "lucide-react";
import { Button } from "../../components/ui/button";
import { ErrorState, Kbd, Skeleton } from "../../components/ui/misc";
import { api } from "../../lib/ipc";
import { qk } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { FocusSessionSummary, FocusState, Space } from "../../lib/types";
import { cn, dayLabel, formatDuration, formatShortMinutes } from "../../lib/utils";
import { useUi } from "../../stores/ui";
import { StudioSubpanel } from "../space/StudioSubpanel";
import { ParkingInput, ParkingList, useFocusActions } from "./controls";
import { loadFocusState, useFocusStore } from "./focusStore";
import { MicroEntryRow } from "./MicroSteps";
import { TimeBar } from "./TimeBar";
import { clockText, phaseLabel } from "./timer";

function Running({ state }: { state: FocusState }) {
  const { run, pending } = useFocusActions();
  const isWork = state.phase === "work";
  const canTakeBreak = isWork && (state.technique === "flowtime" || state.technique === "timebox");
  const needApp = !isWork && state.pauseReason === "needApp";
  return (
    <>
      <p className="flex items-center gap-2 font-medium text-fg-secondary">
        {phaseLabel(state)} · {s.focus.block(state.block)}
      </p>
      {state.goal && <p className="-mt-2 text-label text-muted">{state.goal}</p>}
      <p className={cn("text-timer font-medium tabular-nums", state.paused && "opacity-40")}>{clockText(state)}</p>
      <TimeBar state={state} />
      <div className="grid grid-cols-2 gap-2">
        {isWork || needApp ? (
          <Button
            variant="primary"
            disabled={!!pending}
            onClick={() => run(isWork && !state.paused ? "pause" : "resume")}
          >
            {needApp ? <Coffee size={15} /> : state.paused ? <Play size={15} /> : <Pause size={15} />}
            {needApp ? s.focus.resumeBreak : state.paused ? s.focus.resume : s.focus.pause}
          </Button>
        ) : (
          <span />
        )}
        <Button variant="secondary" disabled={!!pending} onClick={() => run("stop")}>
          {s.focus.end}
        </Button>
      </div>
      {canTakeBreak && (
        <Button variant="ghost" size="sm" className="-mt-1.5 self-start" disabled={!!pending} onClick={() => run("endWork")}>
          <Coffee size={14} /> {s.focus.takeBreak}
        </Button>
      )}
    </>
  );
}

function Idle({ elsewhere }: { elsewhere: boolean }) {
  const open = useUi((st) => st.setFocusDialogOpen);
  return (
    <>
      {elsewhere && <p className="text-body text-muted">{s.focus.otherSpace}</p>}
      <p className="text-timer font-medium tabular-nums opacity-40">{formatDuration(25 * 60_000)}</p>
      {!elsewhere && (
        <Button variant="primary" className="self-start" onClick={() => open(true)}>
          <Play size={15} /> {s.focus.begin}
        </Button>
      )}
    </>
  );
}

function ParkingSection({ spaceId, state }: { spaceId: string; state: FocusState | null }) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: qk.parking(null),
    queryFn: () => api.parkingList(null),
  });
  const items = (data ?? []).filter(
    (p) => !p.resolved && (p.spaceId === spaceId || (!!state && p.sessionId === state.sessionId)),
  );
  return (
    <div className="flex flex-col gap-2 pt-1.5">
      <h3 className="flex items-center gap-1.5 text-label font-semibold text-muted">
        {s.focus.parking} {state && <Kbd>{s.focus.parkingShortcut}</Kbd>}
      </h3>
      {state && <ParkingInput />}
      {isLoading && <Skeleton className="h-8" />}
      {error && (
        <p className="text-label text-danger">
          {s.focus.parkingLoadFailed}.{" "}
          <button className="underline" onClick={() => refetch()}>
            {s.common.retry}
          </button>
        </p>
      )}
      {data && items.length === 0 && <p className="text-label text-muted">{state ? s.focus.parkingEmpty : s.focus.parkingIdle}</p>}
      {items.length > 0 && <ParkingList items={items} />}
    </div>
  );
}

function HistoryRow({ x }: { x: FocusSessionSummary }) {
  const right =
    x.endedAt == null
      ? s.focus.inProgress
      : [s.focus.focusedShort(formatShortMinutes(x.focusMs)), x.pauses ? s.focus.pauses(x.pauses) : null].filter(Boolean).join(" · ");
  return (
    <li className="flex min-h-[60px] items-center gap-3 py-2 not-first:min-h-[61px] not-first:border-t not-first:border-divider">
      <div className="flex min-w-0 flex-1 flex-col gap-px">
        <span className="text-body-lg font-medium">{dayLabel(x.startedAt)}</span>
        {x.goal && <span className="truncate text-label text-muted">{x.goal}</span>}
      </div>
      <span className="shrink-0 text-muted">{right}</span>
    </li>
  );
}

function HistorySection({ spaceId }: { spaceId: string }) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: qk.focusHistory(spaceId),
    queryFn: () => api.focusHistory(spaceId),
  });
  return (
    <div className="flex flex-col gap-1 pt-1.5">
      <h3 className="text-label font-semibold text-muted">{s.focus.history}</h3>
      {isLoading && (
        <div className="flex flex-col gap-2 pt-1">
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
        </div>
      )}
      {error && <ErrorState className="py-4" title={s.focus.historyFailed} error={error} onRetry={() => refetch()} />}
      {data && data.length === 0 && <p className="text-label text-muted">{s.focus.historyEmpty}</p>}
      {data && data.length > 0 && (
        <ul className="flex flex-col gap-1">
          {data.slice(0, 20).map((x) => (
            <HistoryRow key={x.id} x={x} />
          ))}
        </ul>
      )}
    </div>
  );
}

export function FocusView({ space, onBack }: { space: Space; onBack: () => void }) {
  const state = useFocusStore((st) => st.state);
  const loaded = useFocusStore((st) => st.loaded);
  const loadError = useFocusStore((st) => st.loadError);
  const setStudioView = useUi((st) => st.setStudioView);
  const ours = !!state && (state.spaceId === space.id || state.spaceId == null);

  return (
    <StudioSubpanel
      title={s.focus.start}
      onBack={onBack}
      footer={<MicroEntryRow spaceId={space.id} onOpen={() => setStudioView("microsteps", "focus")} />}
    >
      {!loaded && <Skeleton className="h-40" />}
      {loaded && loadError != null && !state && (
        <ErrorState className="py-4" title={s.focus.loadFailed} error={loadError} onRetry={() => loadFocusState().catch(() => {})} />
      )}
      {loaded && loadError == null && (ours ? <Running state={state!} /> : <Idle elsewhere={!!state} />)}
      <ParkingSection spaceId={space.id} state={ours ? state : null} />
      <HistorySection spaceId={space.id} />
    </StudioSubpanel>
  );
}
