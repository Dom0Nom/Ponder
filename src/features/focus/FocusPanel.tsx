import { useQuery } from "@tanstack/react-query";
import { History, StickyNote, Timer } from "lucide-react";
import { Button } from "../../components/ui/button";
import { ErrorState, Kbd, Skeleton } from "../../components/ui/misc";
import { api } from "../../lib/ipc";
import { qk } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { FocusSessionSummary, FocusState } from "../../lib/types";
import { formatMinutes } from "../../lib/utils";
import { useUi } from "../../stores/ui";
import { ParkingInput, ParkingList, SessionControls } from "./controls";
import { loadFocusState, useFocusStore } from "./focusStore";
import { CurrentStepLine, MicroStepsSection } from "./MicroSteps";
import { TimeBar } from "./TimeBar";
import { clockText, phaseLabel } from "./timer";

function CurrentSession({ state, spaceId }: { state: FocusState; spaceId: string }) {
  return (
    <div className="flex flex-col items-center text-center">
      <TimeBar state={state} size={176}>
        <span className="text-3xl font-semibold tabular-nums tracking-tight">{clockText(state)}</span>
        <span className="text-xs text-muted">{state.remainingMs != null ? s.focus.left : s.focus.elapsed}</span>
      </TimeBar>
      <p className="mt-3 text-sm font-semibold">
        {phaseLabel(state)} <span className="font-normal text-faint">· {s.focus.block(state.block)}</span>
      </p>
      <p className="text-xs text-muted">{s.focus.techniques[state.technique]}</p>
      {state.goal && <p className="mt-2 max-w-xs text-[0.8125rem]">{state.goal}</p>}
      <CurrentStepLine spaceId={spaceId} />
      <div className="mt-4">
        <SessionControls state={state} />
      </div>
    </div>
  );
}

function Idle({ elsewhere }: { elsewhere: boolean }) {
  const open = useUi((st) => st.setFocusDialogOpen);
  return (
    <div className="rounded-xl bg-surface-2 px-4 py-5 text-center">
      <p className="text-sm font-medium">{elsewhere ? s.focus.otherSpace : s.focus.idleTitle}</p>
      {!elsewhere && (
        <>
          <p className="mx-auto mt-1 max-w-xs text-xs text-muted">{s.focus.idleBody}</p>
          <Button variant="primary" size="sm" className="mt-3" onClick={() => open(true)}>
            <Timer size={14} /> {s.focus.begin}
          </Button>
        </>
      )}
    </div>
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
    <div>
      <h4 className="mb-2 flex items-center justify-between text-[0.8125rem] font-medium text-muted">
        <span className="flex items-center gap-1.5">
          <StickyNote size={14} /> {s.focus.parking}
        </span>
        {state && <Kbd>{s.focus.parkingShortcut}</Kbd>}
      </h4>
      {state && <ParkingInput className="mb-2" />}
      {isLoading && <Skeleton className="h-8" />}
      {error && (
        <p className="text-xs text-danger">
          {s.focus.parkingLoadFailed}.{" "}
          <button className="underline" onClick={() => refetch()}>
            {s.common.retry}
          </button>
        </p>
      )}
      {data && items.length === 0 && (
        <p className="text-xs text-faint">{state ? s.focus.parkingEmpty : s.focus.parkingIdle}</p>
      )}
      {items.length > 0 && <ParkingList items={items} compact />}
    </div>
  );
}

function HistoryRow({ x }: { x: FocusSessionSummary }) {
  const d = new Date(x.startedAt);
  return (
    <li className="py-2">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-[0.8125rem] font-medium">
          {d.toLocaleDateString(undefined, { month: "short", day: "numeric" })}{" "}
          <span className="font-normal text-faint">
            {d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
          </span>
        </p>
        <p className="shrink-0 text-xs text-muted">{s.focus.techniques[x.technique]}</p>
      </div>
      <p className="text-xs text-muted">
        {x.endedAt == null ? s.focus.inProgress : s.focus.focused(formatMinutes(x.focusMs))} ·{" "}
        {s.focus.pauses(x.pauses)}
      </p>
      {x.goal && <p className="mt-0.5 text-xs text-faint">{x.goal}</p>}
      {x.summary && <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-xs">{x.summary}</p>}
    </li>
  );
}

function HistorySection({ spaceId }: { spaceId: string }) {
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: qk.focusHistory(spaceId),
    queryFn: () => api.focusHistory(spaceId),
  });
  return (
    <div>
      <h4 className="mb-1 flex items-center gap-1.5 text-[0.8125rem] font-medium text-muted">
        <History size={14} /> {s.focus.history}
      </h4>
      {isLoading && (
        <div className="space-y-2 pt-1">
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
        </div>
      )}
      {error && <ErrorState className="py-4" title={s.focus.historyFailed} error={error} onRetry={() => refetch()} />}
      {data && data.length === 0 && <p className="text-xs text-faint">{s.focus.historyEmpty}</p>}
      {data && data.length > 0 && (
        <ul className="divide-y divide-border">
          {data.slice(0, 20).map((x) => (
            <HistoryRow key={x.id} x={x} />
          ))}
        </ul>
      )}
    </div>
  );
}

/** Studio pane section: current session, parking lot, history for the space. */
export function FocusPanel({ spaceId }: { spaceId: string }) {
  const state = useFocusStore((st) => st.state);
  const loaded = useFocusStore((st) => st.loaded);
  const loadError = useFocusStore((st) => st.loadError);
  const ours = !!state && (state.spaceId === spaceId || state.spaceId == null);

  return (
    <section
      aria-label={s.focus.current}
      className="space-y-5 rounded-[var(--radius-card)] border border-border p-4"
    >
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <Timer size={15} className="text-muted" /> {s.focus.start}
      </h3>
      {!loaded && <Skeleton className="mx-auto h-44 w-44 rounded-full" />}
      {loaded && loadError != null && !state && (
        <ErrorState
          className="py-4"
          title={s.focus.loadFailed}
          error={loadError}
          onRetry={() => loadFocusState().catch(() => {})}
        />
      )}
      {loaded && loadError == null && (ours ? <CurrentSession state={state!} spaceId={spaceId} /> : <Idle elsewhere={!!state} />)}
      <MicroStepsSection spaceId={spaceId} state={ours ? state : null} />
      <ParkingSection spaceId={spaceId} state={ours ? state : null} />
      <HistorySection spaceId={spaceId} />
    </section>
  );
}
