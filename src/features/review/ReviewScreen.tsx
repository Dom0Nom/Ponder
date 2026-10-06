import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as Tabs from "@radix-ui/react-tabs";
import { BookOpen, CheckCircle2, Layers, RotateCcw, Trash2 } from "lucide-react";
import { api } from "../../lib/ipc";
import { invalidateCards, qk, useDueCounts, useMistakes, useSpaces } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { Card } from "../../lib/types";
import { cn, relativeTime } from "../../lib/utils";
import { GRADES, previewIntervals, schedule } from "../../lib/srs/scheduler";
import { useUi } from "../../stores/ui";
import { useFocusStore } from "../focus/focusStore";
import { Button } from "../../components/ui/button";
import { EmptyState, ErrorState, Kbd, Skeleton } from "../../components/ui/misc";
import { toastError } from "../../components/ui/toast";
import { CardFace } from "../cards/CardFace";

export function ReviewScreen({ spaceId, tab }: { spaceId?: string; tab?: "cards" | "mistakes" }) {
  const navigate = useUi((st) => st.navigate);
  const { data: spaces } = useSpaces();
  const space = spaces?.find((x) => x.id === spaceId);
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl px-8 pb-16 pt-6">
        <div className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-[1.75rem] font-semibold tracking-tight">{s.review.title}</h1>
            <p className="mt-1 text-muted">{space ? s.review.inSpace(space.name) : s.review.allSpaces}</p>
          </div>
          {space && (
            <Button variant="ghost" size="sm" onClick={() => navigate({ name: "review", tab })}>
              {s.review.showAll}
            </Button>
          )}
        </div>
        <Tabs.Root
          value={tab ?? "cards"}
          onValueChange={(v) => navigate({ name: "review", spaceId, tab: v as "cards" | "mistakes" })}
        >
          <Tabs.List className="mb-5 flex gap-1">
            {(["cards", "mistakes"] as const).map((v) => (
              <Tabs.Trigger
                key={v}
                value={v}
                className="h-8 rounded-full px-3.5 text-[0.8125rem] font-medium text-muted hover:bg-surface-2 data-[state=active]:bg-accent-soft data-[state=active]:text-accent-text"
              >
                {v === "cards" ? s.review.cardsTab : s.review.mistakesTab}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          <Tabs.Content value="cards">
            <ReviewSession key={spaceId ?? "all"} spaceId={spaceId} />
          </Tabs.Content>
          <Tabs.Content value="mistakes">
            <MistakeNotebook spaceId={spaceId} />
          </Tabs.Content>
        </Tabs.Root>
      </div>
    </div>
  );
}

function ReviewSession({ spaceId }: { spaceId?: string }) {
  const due = useQuery({ queryKey: qk.due(spaceId ?? null), queryFn: () => api.cardsDue(spaceId), staleTime: Infinity });
  const counts = useDueCounts();
  const [queue, setQueue] = useState<Card[] | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [done, setDone] = useState(0);
  const [busy, setBusy] = useState(false);
  const shownAt = useRef(Date.now());
  const navigate = useUi((st) => st.navigate);
  const openViewer = useUi((st) => st.openViewer);
  const locked = useFocusStore((st) => st.breakLocked);

  useEffect(() => {
    if (due.data && queue == null) setQueue(due.data);
  }, [due.data, queue]);

  const card = queue?.[0];
  const previews = useMemo(() => (card ? previewIntervals(card) : {}), [card]);

  useEffect(() => {
    shownAt.current = Date.now();
    setRevealed(false);
  }, [card?.id]);

  const rate = useCallback(
    async (rating: number) => {
      if (!card || busy) return;
      setBusy(true);
      try {
        const next = schedule(card, rating as 1 | 2 | 3 | 4);
        await api.cardReview(card.id, rating, next.fsrs, next.due, next.state, Date.now() - shownAt.current, next.log);
        setDone((d) => d + 1);
        // cards still due within this session (learning steps) go to the back of the queue
        setQueue((q) => {
          const rest = (q ?? []).slice(1);
          return next.due - Date.now() < 20 * 60_000 ? [...rest, { ...card, ...next, fsrs: next.fsrs }] : rest;
        });
        invalidateCards(card.spaceId);
      } catch (e) {
        toastError(s.review.saveFailed, e);
      } finally {
        setBusy(false);
      }
    },
    [card, busy],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (locked || e.metaKey || e.ctrlKey || (e.target as HTMLElement)?.closest("input, textarea, [role=dialog]")) return;
      if (!revealed && (e.key === " " || e.key === "Enter")) {
        e.preventDefault();
        setRevealed(true);
      } else if (revealed && ["1", "2", "3", "4"].includes(e.key)) {
        e.preventDefault();
        rate(Number(e.key));
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [revealed, rate, locked]);

  if (due.isLoading || queue == null) return <Skeleton className="h-72 rounded-[var(--radius-pane)]" />;
  if (due.error) return <ErrorState title={s.review.loadFailed} error={due.error} onRetry={() => due.refetch()} />;

  if (!card) {
    const totals = (counts.data ?? []).filter((c) => !spaceId || c.spaceId === spaceId);
    const total = totals.reduce((n, c) => n + c.total, 0);
    return (
      <div className="rounded-[var(--radius-pane)] bg-surface py-6 shadow-card" data-testid="review-empty">
        <EmptyState
          icon={done ? <CheckCircle2 size={22} /> : <Layers size={22} />}
          title={done ? s.review.finished(done) : total ? s.review.nothingDue : s.review.noCards}
          body={done || total ? s.review.comeBack : s.review.noCardsBody}
          action={
            !total && spaceId ? (
              <Button variant="primary" onClick={() => navigate({ name: "space", spaceId })}>
                {s.review.goToSpace}
              </Button>
            ) : undefined
          }
        />
      </div>
    );
  }

  return (
    <div data-testid="review-session">
      <div className="mb-3 flex items-center justify-between text-xs text-muted">
        <span>{s.review.remaining(queue.length, done)}</span>
        <span className="flex items-center gap-2">
          {!spaceId && <span className="rounded-full bg-surface-2 px-2 py-0.5">{card.spaceName}</span>}
          {card.state === 0 && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-accent-text">{s.review.new}</span>}
          {card.origin === "mistake" && <span className="rounded-full bg-warn-soft px-2 py-0.5 text-warn">{s.review.fromMistake}</span>}
        </span>
      </div>
      <div className="min-h-64 rounded-[var(--radius-pane)] bg-surface p-8 shadow-card">
        <CardFace key={card.id} card={card} revealed={revealed} onPick={() => setRevealed(true)} />
        {revealed && card.sourceId && (
          <button
            onClick={() => {
              navigate({ name: "space", spaceId: card.spaceId });
              setTimeout(() => openViewer({ sourceId: card.sourceId!, start: card.chunkStart ?? undefined, end: card.chunkEnd ?? undefined }), 50);
            }}
            className="mt-5 inline-flex items-center gap-1.5 text-xs font-medium text-accent-text hover:underline"
          >
            <BookOpen size={13} /> {s.review.showSource}
          </button>
        )}
      </div>
      <div className="mt-5 flex justify-center gap-2">
        {!revealed ? (
          <Button variant="primary" size="lg" onClick={() => setRevealed(true)}>
            {s.review.show} <Kbd>Space</Kbd>
          </Button>
        ) : (
          GRADES.map((g) => (
            <button
              key={g.rating}
              disabled={busy}
              onClick={() => rate(g.rating)}
              className={cn(
                "flex min-w-24 flex-col items-center rounded-2xl border px-4 py-2 text-sm font-medium transition-colors",
                g.rating === 1 ? "border-danger/40 text-danger hover:bg-danger-soft" : "border-border hover:bg-surface-2",
                g.rating === 3 && "border-accent bg-accent-soft text-accent-text",
              )}
            >
              {g.label}
              <span className="text-[0.6875rem] font-normal text-muted">
                {previews[g.rating]} · {g.key}
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

function MistakeNotebook({ spaceId }: { spaceId?: string }) {
  const { data, isLoading, error, refetch } = useMistakes(spaceId ?? null);
  const [showResolved, setShowResolved] = useState(false);
  if (isLoading) return <Skeleton className="h-40" />;
  if (error) return <ErrorState title={s.errors.generic} error={error} onRetry={() => refetch()} />;
  const open = (data ?? []).filter((m) => !m.resolved);
  const resolved = (data ?? []).filter((m) => m.resolved);
  const list = showResolved ? data ?? [] : open;
  if (!data?.length)
    return (
      <div className="rounded-[var(--radius-pane)] bg-surface py-6 shadow-card">
        <EmptyState icon={<CheckCircle2 size={22} />} title={s.mistakes.emptyTitle} body={s.mistakes.emptyBody} />
      </div>
    );
  return (
    <div data-testid="mistake-notebook">
      <div className="mb-3 flex items-center justify-between text-xs text-muted">
        <span>{s.mistakes.summary(open.length, resolved.length)}</span>
        {resolved.length > 0 && (
          <button className="font-medium text-accent-text hover:underline" onClick={() => setShowResolved(!showResolved)}>
            {showResolved ? s.mistakes.hideFixed : s.mistakes.showFixed}
          </button>
        )}
      </div>
      <ul className="space-y-2">
        {list.map((m) => (
          <li key={m.id} className={cn("rounded-2xl bg-surface p-4 shadow-card", m.resolved && "opacity-60")} data-testid="mistake">
            <div className="flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium">{m.question}</p>
                <p className="mt-1.5 text-xs">
                  {m.given != null && (
                    <span className="mr-3 text-danger">
                      {s.mistakes.yours}: {m.given}
                    </span>
                  )}
                  <span className="text-success">
                    {s.mistakes.correct}: {m.correct}
                  </span>
                </p>
                {m.explanation && <p className="mt-1 text-xs text-muted">{m.explanation}</p>}
                <p className="mt-1.5 text-[0.6875rem] text-faint">
                  {[m.origin, m.topic, relativeTime(m.createdAt)].filter(Boolean).join(" · ")}
                  {m.resolved && ` · ${s.mistakes.fixed}`}
                </p>
              </div>
              <button
                aria-label={m.resolved ? s.mistakes.reopen : s.mistakes.markFixed}
                title={m.resolved ? s.mistakes.reopen : s.mistakes.markFixed}
                onClick={async () => {
                  try {
                    await api.mistakeSetResolved(m.id, !m.resolved);
                    invalidateCards();
                  } catch (e) {
                    toastError(s.errors.generic, e);
                  }
                }}
                className="rounded-full p-1.5 text-muted hover:bg-surface-2 hover:text-fg"
              >
                {m.resolved ? <RotateCcw size={15} /> : <CheckCircle2 size={15} />}
              </button>
              <button
                aria-label={s.common.delete}
                onClick={async () => {
                  try {
                    await api.mistakeDelete(m.id);
                    invalidateCards();
                  } catch (e) {
                    toastError(s.errors.generic, e);
                  }
                }}
                className="rounded-full p-1.5 text-muted hover:bg-danger-soft hover:text-danger"
              >
                <Trash2 size={15} />
              </button>
            </div>
          </li>
        ))}
      </ul>
      <p className="mt-4 text-xs text-muted">{s.mistakes.howItWorks}</p>
    </div>
  );
}
