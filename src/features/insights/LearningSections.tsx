import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Lock } from "lucide-react";
import { api } from "../../lib/ipc";
import { appNow } from "../../lib/plan/clock";
import { qk, useMastery } from "../../lib/queries";
import { s } from "../../lib/strings";
import { formatDate, formatPercent } from "../../lib/i18n/format";
import { calibration } from "../../lib/insights/calibration";
import { masteredCount, masteryMap } from "../../lib/insights/mastery";
import { groupPatterns, type Pattern, type PatternId } from "../../lib/insights/patterns";
import type { AttemptRow, TopicRef } from "../../lib/types";
import { cn } from "../../lib/utils";
import { useUi } from "../../stores/ui";
import { LearnChevron } from "../../components/motion/LearnChevron";
import { NumberPop } from "../../components/motion/NumberPop";
import { Collapse, Reveal } from "../../components/motion/Reveal";
import { SuccessCheck } from "../../components/motion/SuccessCheck";
import { TextSwap } from "../../components/motion/TextSwap";
import { ErrorState, Skeleton } from "../../components/ui/misc";

export function InsightSection({ title, body, children, testId }: { title: string; body?: string; children: ReactNode; testId?: string }) {
  return (
    <section className="flex flex-col gap-3 rounded-card border border-border px-5 py-4" data-testid={testId}>
      <div className="flex flex-col gap-0.5">
        <h2 className="text-title-sm font-semibold">{title}</h2>
        {body && <p className="text-muted">{body}</p>}
      </div>
      {children}
    </section>
  );
}

export function CalibrationSection({ attempts, topics }: { attempts: AttemptRow[]; topics: TopicRef[] }) {
  const title = new Map(topics.map((t) => [t.id, t.title]));
  const rows = calibration(attempts).filter((c) => c.sureN > 0);
  return (
    <InsightSection title={s.confidence.calibrationTitle} body={s.confidence.calibrationFootnote} testId="insights-calibration">
      {rows.length === 0 ? (
        <p className="text-muted">{s.confidence.calibrationEmpty}</p>
      ) : (
        <ul className="flex flex-col">
          {rows.map((c, i) => (
            <Reveal as="li" key={c.topicKey} index={i} className="flex items-baseline gap-3 py-2 [&+&]:border-t [&+&]:border-divider" data-testid="calibration-row">
              <span className="min-w-0 flex-1 truncate font-semibold">{title.get(c.topicKey) ?? c.topicKey.replace(/^free:/, "")}</span>
              <span className="text-fg-secondary tabular-nums">{s.confidence.calibrationRow(c.sureRight, c.sureN)}</span>
              <span className="w-12 text-end font-semibold tabular-nums">
                <NumberPop text={formatPercent(c.sureAccuracy ?? 0)} popKey={formatPercent(c.sureAccuracy ?? 0)} onMount />
              </span>
              {c.overconfident && <span className="rounded-btn bg-warn-soft px-2 py-0.5 text-label">{s.confidence.overconfident}</span>}
            </Reveal>
          ))}
        </ul>
      )}
    </InsightSection>
  );
}

export function MasteryStatusSection({ spaceId, topics }: { spaceId: string; topics: TopicRef[] }) {
  const mastery = useMastery(spaceId);
  const abilities = useQuery({ queryKey: ["abilities", spaceId], queryFn: () => api.abilitiesList(spaceId) });
  if (mastery.isLoading || abilities.isLoading) return <Skeleton className="h-40 rounded-card" />;
  const err = mastery.error ?? abilities.error;
  if (err) return <ErrorState title={s.insights.loadError} error={err} onRetry={() => { mastery.refetch(); abilities.refetch(); }} />;
  const rows = mastery.data ?? [];
  const now = appNow();
  const nodes = masteryMap(topics, rows, new Set((abilities.data ?? []).map((a) => a.topicKey)), now);
  const byKey = new Map(rows.map((r) => [r.topicKey, r]));
  const count = masteredCount(rows);
  return (
    <InsightSection title={s.mastery.title} body={s.mastery.note} testId="insights-mastery-status">
      <p className="font-semibold tabular-nums" data-testid="mastered-count">
        <MasteredText n={count} />
      </p>
      <ul className="flex flex-col">
        {nodes.map((n) => {
          const row = byKey.get(n.topicKey);
          const locked = n.waitsFor.length > 0;
          return (
            <li key={n.topicKey} className="flex items-baseline gap-3 py-1.5 [&+&]:border-t [&+&]:border-divider" data-testid="mastery-row" data-status={n.status}>
              <span className="flex min-w-0 flex-1 items-center gap-2 truncate">
                {locked ? <Lock size={13} className="shrink-0 text-muted" aria-label={s.mastery.locked} /> : n.status === "mastered" ? <SuccessCheck size={13} /> : null}
                <span className="truncate">{n.title}</span>
              </span>
              <span className="text-label text-muted">
                {locked
                  ? s.mastery.waitsFor(n.waitsFor.join(", "))
                  : n.status === "waiting" && row?.retestDueAt
                    ? s.mastery.retestOn(formatDate(row.retestDueAt, { month: "short", day: "numeric" }))
                    : null}
              </span>
              <TextSwap text={locked ? s.mastery.locked : s.mastery.status[n.status]} className={cn("w-24 text-end text-label font-semibold", n.status === "mastered" && "text-success-text")} />
            </li>
          );
        })}
      </ul>
    </InsightSection>
  );
}

function MasteredText({ n }: { n: number }) {
  const text = s.mastery.mastered(n);
  const at = text.indexOf(String(n));
  return (
    <>
      {text.slice(0, at)}
      <NumberPop text={String(n)} popKey={n} onMount />
      {text.slice(at + String(n).length)}
    </>
  );
}

/** Pattern rows with examples; "Practice this" opens practice on the pattern's top topic. */
export function PatternList({ patterns, topics, spaceId }: { patterns: Pattern[]; topics: TopicRef[]; spaceId: string }) {
  const navigate = useUi((st) => st.navigate);
  const [open, setOpen] = useState<PatternId | null>(null);
  const keyOf = (title: string) => topics.find((t) => t.title === title)?.id ?? `free:${title}`;
  return (
    <ul className="flex flex-col gap-2" data-testid="pattern-list">
      {patterns.map((p, i) => (
        <Reveal as="li" key={p.id} index={i} y={14} className="flex flex-col rounded-card border border-border" data-testid="pattern" data-pattern={p.id}>
          <div className="flex items-center gap-3 px-3.5 py-3">
            <button
              type="button"
              className="flex min-w-0 flex-1 items-baseline gap-3 text-start"
              aria-expanded={open === p.id}
              onClick={() => setOpen(open === p.id ? null : p.id)}
            >
              <span className="font-semibold">{s.patterns.kinds[p.id]}</span>
              <span className="text-label text-muted tabular-nums">{s.patterns.count(p.count)}</span>
            </button>
            {p.topics[0] && (
              <button
                type="button"
                className="t-learn flex items-center gap-1.5 rounded-btn px-2 py-1 text-label font-semibold hover:bg-fill-faint"
                onClick={() => navigate({ name: "practice", spaceId, topicKey: keyOf(p.topics[0]), topicTitle: p.topics[0] })}
              >
                {s.patterns.practiceThis}
                <LearnChevron size={13} />
              </button>
            )}
          </div>
          <Collapse open={open === p.id}>
            <ul className="flex flex-col gap-2 border-t border-divider px-3.5 py-3">
              {p.examples.map((e) => (
                <li key={e.id} className="flex flex-col gap-0.5 text-body">
                  <span className="line-clamp-2 font-medium">{e.question}</span>
                  <span className="text-label text-muted">{e.given ? s.patterns.given(e.given) : s.patterns.unanswered}</span>
                  <span className="text-label text-fg-secondary">{s.patterns.correct(e.correct)}</span>
                </li>
              ))}
            </ul>
          </Collapse>
        </Reveal>
      ))}
    </ul>
  );
}

export function PatternsSection({ spaceId, topics }: { spaceId: string; topics: TopicRef[] }) {
  const mistakes = useQuery({ queryKey: qk.mistakes(spaceId), queryFn: () => api.mistakesList(spaceId) });
  if (mistakes.isLoading) return <Skeleton className="h-32 rounded-card" />;
  if (mistakes.error) return <ErrorState title={s.insights.loadError} error={mistakes.error} onRetry={() => mistakes.refetch()} />;
  const patterns = groupPatterns(
    (mistakes.data ?? []).map((m) => ({ id: m.id, question: m.question, given: m.given, correct: m.correct, topic: m.topic, errorType: m.errorType })),
  );
  return (
    <InsightSection title={s.patterns.title} testId="insights-patterns">
      {patterns.length === 0 ? <p className="text-muted">{s.patterns.empty}</p> : <PatternList patterns={patterns} topics={topics} spaceId={spaceId} />}
    </InsightSection>
  );
}
