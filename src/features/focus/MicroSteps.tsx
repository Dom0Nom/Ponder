import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, Check, ListChecks, Pencil, Sparkles, X } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Checkbox16 } from "../../components/ui/checkbox";
import { Input } from "../../components/ui/input";
import { ErrorState, Skeleton, Spinner } from "../../components/ui/misc";
import { toastError } from "../../components/ui/toast";
import { useGenerateMicroSteps } from "../../lib/focus/useGenerateMicroSteps";
import { api } from "../../lib/ipc";
import { qk } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { MicroStep, Space } from "../../lib/types";
import { cn } from "../../lib/utils";
import { StudioSubpanel } from "../space/StudioSubpanel";
import { useFocusStore } from "./focusStore";

export function useMicroSteps(spaceId: string) {
  return useQuery({ queryKey: qk.microSteps(spaceId), queryFn: () => api.microStepsList(spaceId) });
}

/** Row in the Focus view that opens the steps list; shows the first unfinished step when there is one. */
export function MicroEntryRow({ spaceId, onOpen }: { spaceId: string; onOpen: () => void }) {
  const { data } = useMicroSteps(spaceId);
  const next = data?.find((x) => !x.done);
  const done = data?.filter((x) => x.done).length ?? 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      className="-ml-2.25 flex min-h-7.5 min-w-0 flex-1 items-center gap-1.5 rounded-btn px-2.25 text-left text-body font-medium hover:bg-fill"
    >
      <ListChecks size={14} className="shrink-0" />
      {data?.length ? (
        <>
          <span className="min-w-0 flex-1 truncate" data-testid="micro-current">
            {next ? (
              <>
                <span className="text-muted">{s.focus.micro.next}: </span>
                {next.text}
              </>
            ) : (
              s.focus.micro.doneTitle
            )}
          </span>
          <span className="shrink-0 text-label font-normal text-muted">{s.focus.micro.progress(done, data.length)}</span>
        </>
      ) : (
        s.focus.micro.title
      )}
    </button>
  );
}

function StepRow({ step, current, onChanged }: { step: MicroStep; current: boolean; onChanged: () => void }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(step.text);

  const run = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      onChanged();
    } catch (e) {
      toastError(s.focus.micro.saveFailed, e);
    }
  };
  const save = async () => {
    const value = text.trim();
    if (!value || value === step.text) {
      setText(step.text);
      setEditing(false);
      return;
    }
    await run(() => api.microStepUpdate(step.id, { text: value }));
    setEditing(false);
  };

  return (
    <li
      data-testid="micro-step"
      data-done={step.done}
      data-current={current}
      className="group relative flex min-h-10.5 items-start gap-2.5 py-2.5 not-first:border-t not-first:border-divider"
    >
      <Checkbox16
        className="mt-0.5"
        aria-label={s.focus.micro.markDone(step.text)}
        checked={step.done}
        onChange={(e) => {
          const done = e.target.checked;
          qc.setQueryData<MicroStep[]>(qk.microSteps(step.spaceId ?? ""), (old) =>
            old?.map((x) => (x.id === step.id ? { ...x, done } : x)),
          );
          void run(() => api.microStepSetDone(step.id, done));
        }}
      />
      {editing ? (
        <form
          className="flex min-w-0 flex-1 gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Input
            autoFocus
            aria-label={s.focus.micro.edit}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.stopPropagation();
                setText(step.text);
                setEditing(false);
              }
            }}
            className="h-7"
          />
          <Button type="submit" size="icon-sm" variant="ghost" aria-label={s.focus.micro.save}>
            <Check size={14} />
          </Button>
        </form>
      ) : (
        <>
          <span
            className={cn(
              "min-w-0 flex-1 leading-[1.45]",
              step.done && "text-muted line-through",
              current && "font-semibold",
            )}
          >
            {step.text}
          </span>
          <span className="shrink-0 whitespace-nowrap text-label text-muted">{s.focus.micro.minutes(step.minutes)}</span>
          <span className="absolute right-0 top-1.5 hidden items-center rounded-btn bg-surface group-focus-within:flex group-hover:flex">
            <button
              type="button"
              aria-label={s.focus.micro.edit}
              onClick={() => setEditing(true)}
              className="rounded-btn p-1 text-muted hover:text-fg"
            >
              <Pencil size={13} />
            </button>
            <button
              type="button"
              aria-label={s.focus.micro.remove}
              onClick={() => run(() => api.microStepDelete(step.id))}
              className="rounded-btn p-1 text-muted hover:text-danger"
            >
              <X size={13} />
            </button>
          </span>
        </>
      )}
    </li>
  );
}

/** "Where do I start?" for a space: topic prompt when empty, otherwise the checklist. */
export function MicroStepsView({ space, onBack }: { space: Space; onBack: () => void }) {
  const spaceId = space.id;
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useMicroSteps(spaceId);
  const state = useFocusStore((st) => st.state);
  const { generate, busy } = useGenerateMicroSteps(spaceId);
  const [topic, setTopic] = useState("");

  const sessionGoal = state && (state.spaceId === spaceId || state.spaceId == null) ? state.goal?.trim() || null : null;
  const refresh = () => qc.invalidateQueries({ queryKey: qk.microSteps(spaceId) });
  const total = data?.length ?? 0;
  const done = data?.filter((x) => x.done).length ?? 0;
  const current = data?.find((x) => !x.done);
  const goalOfList = data?.[0]?.goal ?? null;
  const regenGoal = sessionGoal ?? goalOfList;

  const clear = async () => {
    try {
      await api.microStepsClear(spaceId);
      await refresh();
    } catch (e) {
      toastError(s.focus.micro.saveFailed, e);
    }
  };
  const finishCurrent = async () => {
    if (!current) return;
    qc.setQueryData<MicroStep[]>(qk.microSteps(spaceId), (old) => old?.map((x) => (x.id === current.id ? { ...x, done: true } : x)));
    try {
      await api.microStepSetDone(current.id, true);
    } catch (e) {
      toastError(s.focus.micro.saveFailed, e);
      await refresh();
    }
  };

  const footer =
    total > 0 ? (
      <>
        {current && (
          <Button variant="primary" onClick={() => void finishCurrent()}>
            <ArrowRight size={15} /> {s.focus.micro.nextStep}
          </Button>
        )}
        <Button variant="ghost" size="sm" className="self-center" disabled={busy || !regenGoal} onClick={() => regenGoal && void generate(regenGoal, state?.sessionId ?? null)}>
          {busy && <Spinner size={13} />} {busy ? s.focus.micro.generating : s.focus.micro.regenerate}
        </Button>
        <Button variant="ghost" size="sm" className="self-center" disabled={busy} onClick={() => void clear()}>
          {s.focus.micro.clear}
        </Button>
      </>
    ) : undefined;

  return (
    <StudioSubpanel title={s.focus.micro.title} onBack={onBack} footer={footer} testId="micro-steps">
      {isLoading && <Skeleton className="h-40 rounded-card" />}
      {error && <ErrorState className="py-4" title={s.focus.micro.loadFailed} error={error} onRetry={() => refetch()} />}
      {data && total === 0 && sessionGoal && (
        <Button variant="primary" className="self-start" disabled={busy} onClick={() => void generate(sessionGoal, state?.sessionId ?? null)}>
          {busy ? <Spinner size={14} className="text-on-primary" /> : <Sparkles size={15} />}{" "}
          {busy ? s.focus.micro.generating : s.focus.micro.button}
        </Button>
      )}
      {data && total === 0 && !sessionGoal && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const g = topic.trim();
            if (g && !busy) void generate(g, state?.sessionId ?? null).then((n) => n && setTopic(""));
          }}
        >
          <Input
            aria-label={s.focus.micro.topicLabel}
            placeholder={s.focus.micro.topicPlaceholder}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            disabled={busy}
          />
          <Button type="submit" variant="primary" className="self-start" disabled={!topic.trim() || busy}>
            {busy ? <Spinner size={14} className="text-on-primary" /> : <Sparkles size={15} />}{" "}
            {busy ? s.focus.micro.generating : s.focus.micro.go}
          </Button>
        </form>
      )}
      {data && total > 0 && (
        <>
          {goalOfList && <p className="text-body leading-[1.45] text-muted">{s.focus.micro.forGoal(goalOfList)}</p>}
          <div className="flex items-center gap-2.5">
            <span className="h-1 w-30 rounded-[2px] bg-fill-active">
              <span className="block h-full rounded-[2px] bg-primary" style={{ width: `${(done / total) * 100}%` }} />
            </span>
            <span className="font-semibold tabular-nums" data-testid="micro-progress">
              {s.focus.micro.progress(done, total)}
            </span>
          </div>
          {done === total && (
            <div className="rounded-card bg-fill px-3 py-2 text-center" data-testid="micro-done">
              <p className="font-semibold">{s.focus.micro.doneTitle}</p>
              <p className="text-label text-muted">{s.focus.micro.doneBody}</p>
            </div>
          )}
          <ul className="rounded-card border border-border px-3.5">
            {data.map((x) => (
              <StepRow key={x.id} step={x} current={x.id === current?.id} onChanged={() => void refresh()} />
            ))}
          </ul>
        </>
      )}
    </StudioSubpanel>
  );
}
