import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Footprints, Pencil, RefreshCw, Sparkles, Trash2, X } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { ErrorState, Skeleton, Spinner } from "../../components/ui/misc";
import { toastError } from "../../components/ui/toast";
import { NoModelError, resolveChatModel } from "../../lib/chat/llm";
import { generateMicroSteps } from "../../lib/focus/microSteps";
import { api } from "../../lib/ipc";
import { qk } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { FocusState, MicroStep } from "../../lib/types";
import { cn } from "../../lib/utils";

function useMicroSteps(spaceId: string) {
  return useQuery({ queryKey: qk.microSteps(spaceId), queryFn: () => api.microStepsList(spaceId) });
}

/** One line under the timer while a session runs: the first unfinished step. */
export function CurrentStepLine({ spaceId }: { spaceId: string }) {
  const { data } = useMicroSteps(spaceId);
  if (!data?.length) return null;
  const next = data.find((x) => !x.done);
  const done = data.filter((x) => x.done).length;
  return (
    <p className="mt-2 flex max-w-xs items-start justify-center gap-1.5 text-[0.8125rem]" data-testid="micro-current">
      <Footprints size={14} className="mt-0.5 shrink-0 text-accent" aria-hidden />
      <span>
        {next ? (
          <>
            <span className="text-muted">{s.focus.micro.next}: </span>
            {next.text}
          </>
        ) : (
          s.focus.micro.doneTitle
        )}{" "}
        <span className="text-faint">({s.focus.micro.progress(done, data.length)})</span>
      </span>
    </p>
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
      className={cn("group flex items-start gap-2 rounded-lg px-2 py-1.5", current && "bg-accent-soft")}
    >
      <input
        type="checkbox"
        aria-label={s.focus.micro.markDone(step.text)}
        checked={step.done}
        onChange={(e) => {
          const done = e.target.checked;
          qc.setQueryData<MicroStep[]>(qk.microSteps(step.spaceId ?? ""), (old) =>
            old?.map((x) => (x.id === step.id ? { ...x, done } : x)),
          );
          run(() => api.microStepSetDone(step.id, done));
        }}
        className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-[var(--accent)]"
      />
      {editing ? (
        <form
          className="flex min-w-0 flex-1 gap-1"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <Input
            autoFocus
            aria-label={s.focus.micro.edit}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setText(step.text);
                setEditing(false);
              }
            }}
            className="h-7 text-[0.8125rem]"
          />
          <Button type="submit" size="icon-sm" variant="ghost" aria-label={s.focus.micro.save}>
            <Check size={14} />
          </Button>
        </form>
      ) : (
        <>
          <span
            className={cn(
              "min-w-0 flex-1 text-[0.8125rem]",
              step.done && "text-faint line-through",
              current && "font-medium",
            )}
          >
            {step.text}
          </span>
          <span className="shrink-0 pt-0.5 text-xs text-faint">{s.focus.micro.minutes(step.minutes)}</span>
          <span className="flex shrink-0 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
            <button
              type="button"
              aria-label={s.focus.micro.edit}
              onClick={() => setEditing(true)}
              className="rounded p-0.5 text-muted hover:text-fg"
            >
              <Pencil size={13} />
            </button>
            <button
              type="button"
              aria-label={s.focus.micro.remove}
              onClick={() => run(() => api.microStepDelete(step.id))}
              className="rounded p-0.5 text-muted hover:text-danger"
            >
              <X size={13} />
            </button>
          </span>
        </>
      )}
    </li>
  );
}

/** "Where do I start?" for a space: button, topic prompt, and the checklist. */
export function MicroStepsSection({ spaceId, state }: { spaceId: string; state: FocusState | null }) {
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useMicroSteps(spaceId);
  const [asking, setAsking] = useState(false);
  const [topic, setTopic] = useState("");
  const [busy, setBusy] = useState(false);

  const sessionGoal = state?.goal?.trim() || null;
  const refresh = () => qc.invalidateQueries({ queryKey: qk.microSteps(spaceId) });

  const generate = async (goal: string) => {
    setBusy(true);
    try {
      const [space, sources] = await Promise.all([api.getSpace(spaceId), api.listSources(spaceId)]);
      const llm = await resolveChatModel(space);
      const steps = await generateMicroSteps(llm, {
        goal,
        spaceName: space.name,
        sourceTitles: sources.filter((x) => x.status === "ready").map((x) => x.title),
      });
      await api.microStepsReplace(spaceId, state?.sessionId ?? null, goal, steps);
      setAsking(false);
      setTopic("");
      await refresh();
    } catch (e) {
      toastError(e instanceof NoModelError ? s.chat.noModel : s.focus.micro.failed, e, () => generate(goal));
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    try {
      await api.microStepsClear(spaceId);
      await refresh();
    } catch (e) {
      toastError(s.focus.micro.saveFailed, e);
    }
  };

  const start = () => {
    if (sessionGoal) generate(sessionGoal);
    else setAsking(true);
  };
  const goalOfList = data?.[0]?.goal ?? null;
  const total = data?.length ?? 0;
  const done = data?.filter((x) => x.done).length ?? 0;
  const currentId = data?.find((x) => !x.done)?.id;

  return (
    <div data-testid="micro-steps">
      <h4 className="mb-2 flex items-center justify-between text-[0.8125rem] font-medium text-muted">
        <span className="flex items-center gap-1.5">
          <Footprints size={14} /> {s.focus.micro.title}
        </span>
        {total > 0 && (
          <span className="text-xs tabular-nums" data-testid="micro-progress">
            {s.focus.micro.progress(done, total)}
          </span>
        )}
      </h4>
      {isLoading && <Skeleton className="h-16" />}
      {error && <ErrorState className="py-4" title={s.focus.micro.loadFailed} error={error} onRetry={() => refetch()} />}
      {data && total === 0 && !asking && (
        <Button size="sm" variant="tonal" onClick={start} disabled={busy}>
          {busy ? <Spinner size={14} /> : <Sparkles size={14} />} {busy ? s.focus.micro.generating : s.focus.micro.button}
        </Button>
      )}
      {data && total === 0 && asking && (
        <form
          className="space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (topic.trim() && !busy) generate(topic.trim());
          }}
        >
          <Input
            autoFocus
            aria-label={s.focus.micro.topicLabel}
            placeholder={s.focus.micro.topicPlaceholder}
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            disabled={busy}
            className="h-9"
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" variant="primary" disabled={!topic.trim() || busy}>
              {busy ? <Spinner size={14} className="text-on-accent" /> : <Sparkles size={14} />}{" "}
              {busy ? s.focus.micro.generating : s.focus.micro.go}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setAsking(false)} disabled={busy}>
              {s.common.cancel}
            </Button>
          </div>
        </form>
      )}
      {data && total > 0 && (
        <div className="space-y-2">
          {goalOfList && <p className="truncate text-xs text-faint">{s.focus.micro.forGoal(goalOfList)}</p>}
          {done === total && (
            <div className="rounded-xl bg-accent-soft px-3 py-2 text-center" data-testid="micro-done">
              <p className="text-sm font-medium text-accent-text">{s.focus.micro.doneTitle}</p>
              <p className="text-xs text-accent-text">{s.focus.micro.doneBody}</p>
            </div>
          )}
          <ul className="space-y-0.5">
            {data.map((x) => (
              <StepRow key={x.id} step={x} current={x.id === currentId} onChanged={refresh} />
            ))}
          </ul>
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="ghost"
              disabled={busy || !(sessionGoal ?? goalOfList)}
              onClick={() => generate((sessionGoal ?? goalOfList)!)}
            >
              {busy ? <Spinner size={14} /> : <RefreshCw size={14} />} {busy ? s.focus.micro.generating : s.focus.micro.regenerate}
            </Button>
            <Button size="sm" variant="ghost" onClick={clear} disabled={busy}>
              <Trash2 size={14} /> {s.focus.micro.clear}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
