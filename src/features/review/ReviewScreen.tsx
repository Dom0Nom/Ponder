import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import * as Tabs from "@radix-ui/react-tabs";
import { BookOpen, Check, CircleCheck, Layers, RotateCcw, Trash2 } from "lucide-react";
import { api } from "../../lib/ipc";
import { invalidateCards, qk, useDueCounts, useMistakes, useSpaces } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { Card } from "../../lib/types";
import { cn, relativeShort } from "../../lib/utils";
import { GRADES, previewIntervals, schedule } from "../../lib/srs/scheduler";
import { useUi } from "../../stores/ui";
import { useFocusStore } from "../focus/focusStore";
import { NumberPop } from "../../components/motion/NumberPop";
import { Reveal } from "../../components/motion/Reveal";
import { SuccessCheck } from "../../components/motion/SuccessCheck";
import { useSlidingPill } from "../../components/motion/useSlidingPill";
import { motionReduced } from "../../app/useTheme";
import { useFlip } from "../../lib/useFlip";
import { useFreshKeys } from "../../lib/useFreshKeys";
import { Button } from "../../components/ui/button";
import { EmptyState, ErrorState, Skeleton } from "../../components/ui/misc";
import { toastError } from "../../components/ui/toast";
import { CardFace } from "../cards/CardFace";

const SEGMENT =
  "t-tab flex h-7.5 items-center justify-center whitespace-nowrap rounded-item px-2.5 font-medium text-fg hover:bg-fill data-[state=active]:font-semibold";
const SESSION_COL = "m-auto flex w-full max-w-[720px] flex-col gap-5 px-10 pb-12 pt-10";
const STATIC_COL = "mx-auto flex w-full max-w-[760px] flex-col gap-[18px] px-10 pb-12 pt-10";
const RATE =
  "flex flex-col items-center gap-0.5 rounded-tile border py-2.5 transition-colors disabled:opacity-50";
const TONE: Record<number, string> = {
  1: "border-danger-outline text-danger hover:bg-fill-subtle",
  2: "border-control text-fg hover:bg-fill-subtle",
  3: "border-primary bg-primary text-on-primary hover:opacity-90",
  4: "border-control text-fg hover:bg-fill-subtle",
};

export function ReviewScreen({ spaceId, tab }: { spaceId?: string; tab?: "cards" | "mistakes" }) {
  const navigate = useUi((st) => st.navigate);
  const [hasCard, setHasCard] = useState(false);
  const current = tab ?? "cards";
  const list = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLSpanElement>(null);
  useSlidingPill(list, pill, current);
  return (
    <div className="flex h-full overflow-y-auto">
      <div className={current === "cards" && hasCard ? SESSION_COL : STATIC_COL}>
        <h1 className="text-page font-semibold">{s.review.title}</h1>
        <Tabs.Root
          value={current}
          onValueChange={(v) => navigate({ name: "review", spaceId, tab: v as "cards" | "mistakes" })}
          className="contents"
        >
          <Tabs.List ref={list} className="t-tabs inline-flex gap-0.5 self-start rounded-control border border-field p-0.5">
            <span ref={pill} className="t-tabs-pill" aria-hidden />
            {(["cards", "mistakes"] as const).map((v) => (
              <Tabs.Trigger key={v} value={v} className={SEGMENT}>
                {v === "cards" ? s.review.cardsTab : s.review.mistakesTab}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
          <Tabs.Content value="cards" className={cn("t-panel-slide flex flex-col", hasCard ? "gap-5" : "gap-[18px]")} data-open="true">
            <ReviewSession key={spaceId ?? "all"} spaceId={spaceId} onCard={setHasCard} />
          </Tabs.Content>
          <Tabs.Content value="mistakes" className="t-panel-slide flex flex-col gap-[18px]" data-open="true">
            <MistakeNotebook spaceId={spaceId} />
          </Tabs.Content>
        </Tabs.Root>
      </div>
    </div>
  );
}

function FinishedTitle({ n }: { n: number }) {
  const text = s.review.finished(n);
  const at = text.indexOf(String(n));
  return (
    <>
      {text.slice(0, at)}
      <NumberPop text={String(n)} popKey={n} onMount />
      {text.slice(at + String(n).length)}
    </>
  );
}

function ReviewSession({ spaceId, onCard }: { spaceId?: string; onCard: (has: boolean) => void }) {
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
    onCard(!!card);
    return () => onCard(false);
  }, [card, onCard]);

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

  if (due.isLoading || queue == null) return <Skeleton className="h-[264px] rounded-[14px]" />;
  if (due.error) return <ErrorState title={s.review.loadFailed} error={due.error} onRetry={() => due.refetch()} />;

  if (!card) {
    const totals = (counts.data ?? []).filter((c) => !spaceId || c.spaceId === spaceId);
    const total = totals.reduce((n, c) => n + c.total, 0);
    return (
      <div className="flex h-[420px]" data-testid="review-empty">
        <EmptyState
          className="flex-1"
          icon={done ? <SuccessCheck size={20} /> : <Layers size={20} />}
          title={done ? <FinishedTitle n={done} /> : total ? s.review.nothingDue : s.review.noCards}
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

  const meta = [!spaceId && card.spaceName, card.state === 0 && s.review.new, card.origin === "mistake" && s.review.fromMistake].filter(
    Boolean,
  );

  return (
    <div className="contents" data-testid="review-session">
      <div className="mt-2 flex items-center gap-2 text-muted">
        <span className="tabular-nums">{s.review.remaining(queue.length, done)}</span>
        {meta.length > 0 && <span className="ml-auto truncate">{meta.join(" · ")}</span>}
      </div>
      <div key={card.id} className="t-page-enter flex flex-col rounded-[14px] border border-border">
        <CardFace key={card.id} card={card} revealed={revealed} onPick={() => setRevealed(true)} />
        {revealed && card.sourceId && (
          <div className="flex justify-center pb-4">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                navigate({ name: "space", spaceId: card.spaceId });
                setTimeout(
                  () => openViewer({ sourceId: card.sourceId!, start: card.chunkStart ?? undefined, end: card.chunkEnd ?? undefined }),
                  50,
                );
              }}
            >
              <BookOpen size={14} /> {s.review.showSource}
            </Button>
          </div>
        )}
      </div>
      <Reveal key={String(revealed)} className="grid grid-cols-4 gap-2.5">
        {!revealed ? (
          <button
            onClick={() => setRevealed(true)}
            className={cn(RATE, "col-span-4 border-primary bg-primary text-on-primary hover:opacity-90")}
          >
            <span className="text-input font-semibold">{s.review.show}</span>
            <span className="text-label opacity-75">{s.review.spaceKey}</span>
          </button>
        ) : (
          GRADES.map((g) => (
            <button key={g.rating} disabled={busy} onClick={() => rate(g.rating)} className={cn(RATE, TONE[g.rating])}>
              <span className="text-input font-semibold">{g.label}</span>
              <span className="text-label tabular-nums opacity-75">
                {previews[g.rating]} · {g.key}
              </span>
            </button>
          ))
        )}
      </Reveal>
    </div>
  );
}

function MistakeNotebook({ spaceId }: { spaceId?: string }) {
  const { data, isLoading, error, refetch } = useMistakes(spaceId ?? null);
  const { data: spaces } = useSpaces();
  const [showResolved, setShowResolved] = useState(false);
  const [leaving, setLeaving] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const isFresh = useFreshKeys(data?.filter((m) => showResolved || !m.resolved).map((m) => m.id));
  useFlip(listRef, [data, showResolved]);
  if (isLoading) return <Skeleton className="h-40 rounded-card" />;
  if (error) return <ErrorState title={s.errors.generic} error={error} onRetry={() => refetch()} />;
  const open = (data ?? []).filter((m) => !m.resolved);
  const resolved = (data ?? []).filter((m) => m.resolved);
  const list = showResolved ? data ?? [] : open;
  if (!data?.length)
    return (
      <div className="flex h-[420px]">
        <EmptyState className="flex-1" icon={<CircleCheck size={20} />} title={s.mistakes.emptyTitle} body={s.mistakes.emptyBody} />
      </div>
    );
  const spaceName = new Map((spaces ?? []).map((x) => [x.id, x.name]));
  return (
    <div className="contents" data-testid="mistake-notebook">
      <div className="flex items-center gap-2 text-muted">
        <span className="tabular-nums">{s.mistakes.summary(open.length, resolved.length)}</span>
        {resolved.length > 0 && (
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setShowResolved(!showResolved)}>
            {showResolved ? s.mistakes.hideFixed : s.mistakes.showFixed}
          </Button>
        )}
      </div>
      <ul ref={listRef} className="relative rounded-card border border-border px-4">
        {list.map((m) => (
          <Reveal
            as="li"
            key={m.id}
            active={isFresh(m.id)}
            data-flip-key={m.id}
            data-testid="mistake"
            className={cn("flex gap-3 py-3.5 transition-opacity duration-(--motion-fast) [&+&]:border-t [&+&]:border-divider", m.resolved && "opacity-60")}
          >
            <div className="flex min-w-0 flex-1 flex-col gap-1">
              <p className="text-input font-semibold">{m.question}</p>
              <p>
                {m.given != null && (
                  <>
                    <span className="text-danger">
                      {s.mistakes.yours}: {m.given}
                    </span>
                    <span className="text-muted"> · </span>
                  </>
                )}
                <span className="text-success">
                  {s.mistakes.correct}: {m.correct}
                </span>
              </p>
              {m.explanation && <p className="text-fg-secondary">{m.explanation}</p>}
              <p className="text-label text-muted">
                {[
                  !spaceId && spaceName.get(m.spaceId),
                  m.errorType && s.errorTypes[m.errorType],
                  relativeShort(m.createdAt),
                  m.resolved && s.mistakes.fixed,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </div>
            <Button
              variant="ghost-muted"
              size="icon-sm"
              aria-label={m.resolved ? s.mistakes.reopen : s.mistakes.markFixed}
              title={m.resolved ? s.mistakes.reopen : s.mistakes.markFixed}
              onClick={async () => {
                try {
                  if (!m.resolved && !motionReduced()) {
                    setLeaving(m.id);
                    await new Promise((r) => setTimeout(r, 400));
                  }
                  await api.mistakeSetResolved(m.id, !m.resolved);
                  setLeaving(null);
                  invalidateCards();
                } catch (e) {
                  setLeaving(null);
                  toastError(s.errors.generic, e);
                }
              }}
            >
              {m.resolved ? <RotateCcw size={15} /> : leaving === m.id ? <SuccessCheck size={15} /> : <Check size={15} />}
            </Button>
            <Button
              variant="ghost-muted"
              size="icon-sm"
              aria-label={s.common.delete}
              title={s.common.delete}
              onClick={async () => {
                try {
                  await api.mistakeDelete(m.id);
                  invalidateCards();
                } catch (e) {
                  toastError(s.errors.generic, e);
                }
              }}
            >
              <Trash2 size={15} />
            </Button>
          </Reveal>
        ))}
      </ul>
      <p className="text-caption text-muted">{s.mistakes.howItWorks}</p>
    </div>
  );
}
