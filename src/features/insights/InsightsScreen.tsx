import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, ChevronDown } from "lucide-react";
import { api } from "../../lib/ipc";
import { useCurriculum, useDueCounts, useSpaces } from "../../lib/queries";
import { s } from "../../lib/strings";
import { WEEKDAY_DAY, formatPercent, formatClock, formatDate, formatMinutesHuman } from "../../lib/i18n/format";
import type { AttemptRow, InsightsActivity, TopicRef } from "../../lib/types";
import { cn } from "../../lib/utils";
import {
  bestStudyTime,
  dailyMinutes,
  forgetFastest,
  prereqDepth,
  readiness,
  retentionCurve,
  reviewBeforeSleep,
  studyTimes,
  topicMastery,
  usualEnd,
  type TopicMastery,
} from "../../lib/insights/analytics";
import { examFor, type ExamFormat } from "../../lib/exam/formats";
import { useUi } from "../../stores/ui";
import { Button } from "../../components/ui/button";
import { Menu, MenuContent, MenuRadioGroup, MenuRadioItem, MenuTrigger } from "../../components/ui/menu";
import { EmptyState, ErrorState, Skeleton } from "../../components/ui/misc";
import { CalibrationSection, MasteryStatusSection, PatternsSection } from "./LearningSections";
import { scoreBand } from "../../lib/exam/band";
import { ScoreBandView } from "../exam/ScoreBandView";

const DAY = 86_400_000;
const HISTORY_DAYS = 120;
/** Share of exam questions needed to pass, where the exam has one (GED 145/200 scaled, AP 3, IHK 50 points). */
const PASS_MARK: Record<string, number> = { ged: 0.62, "ap-bio": 0.55, "ap-calc-ab": 0.5, "ihk-fiae": 0.5 };

export function InsightsScreen({ spaceId }: { spaceId?: string }) {
  const navigate = useUi((st) => st.navigate);
  const spaces = useSpaces();
  const [now] = useState(() => Date.now());
  const activity = useQuery({
    queryKey: ["insights", spaceId ?? null],
    queryFn: () => api.insightsActivity(spaceId ?? null, now - HISTORY_DAYS * DAY),
  });
  const space = spaces.data?.find((x) => x.id === spaceId);
  const a = activity.data;
  const hasData = !!a && a.reviews.length + a.focus.length + a.attempts.length > 0;
  return (
    <div className="flex h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-[760px] flex-col gap-[18px] px-10 pb-12 pt-10" data-testid="insights">
        <div className="flex items-center gap-3">
          <h1 className="text-page font-semibold">{s.insights.title}</h1>
          <Menu>
            <MenuTrigger asChild>
              <Button variant="secondary" size="sm" className="ms-auto" data-testid="insights-space">
                {space?.name ?? s.insights.allSpaces}
                <ChevronDown size={14} className="text-muted" />
              </Button>
            </MenuTrigger>
            <MenuContent align="end">
              <MenuRadioGroup value={spaceId ?? ""} onValueChange={(v) => navigate({ name: "insights", spaceId: v || undefined })}>
                <MenuRadioItem value="">{s.insights.allSpaces}</MenuRadioItem>
                {(spaces.data ?? []).map((x) => (
                  <MenuRadioItem key={x.id} value={x.id}>
                    {x.name}
                  </MenuRadioItem>
                ))}
              </MenuRadioGroup>
            </MenuContent>
          </Menu>
        </div>
        {activity.isLoading ? (
          <>
            <Skeleton className="h-40 rounded-card" />
            <Skeleton className="h-40 rounded-card" />
          </>
        ) : activity.error ? (
          <ErrorState title={s.insights.loadError} error={activity.error} onRetry={() => activity.refetch()} />
        ) : (
          <>
            {hasData ? (
              <ActivitySections a={a!} now={now} spaceId={spaceId} />
            ) : (
              <div className="flex h-[260px]">
                <EmptyState className="flex-1" icon={<BarChart3 size={20} />} title={s.insights.emptyTitle} body={s.insights.emptyBody} />
              </div>
            )}
            {spaceId ? <MasterySections spaceId={spaceId} attempts={a?.attempts ?? []} /> : null}
          </>
        )}
      </div>
    </div>
  );
}

function Section({ title, body, children, testId }: { title: string; body?: string; children: ReactNode; testId?: string }) {
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

function ActivitySections({ a, now, spaceId }: { a: InsightsActivity; now: number; spaceId?: string }) {
  const navigate = useUi((st) => st.navigate);
  const spaces = useSpaces();
  const due = useDueCounts();
  const days = useMemo(() => dailyMinutes(a, now), [a, now]);
  const curve = useMemo(() => retentionCurve(a.reviews), [a.reviews]);
  const times = useMemo(() => studyTimes(a), [a]);
  const best = bestStudyTime(times);
  const end = useMemo(() => usualEnd(a, now), [a, now]);
  const dueNow = (due.data ?? []).filter((d) => !spaceId || d.spaceId === spaceId).reduce((n, d) => n + d.due, 0);
  const sleep = reviewBeforeSleep(end, dueNow);
  const spaceName = new Map((spaces.data ?? []).map((x) => [x.id, x.name]));
  const forget = forgetFastest(a.reviews, (r) => (spaceId ? null : r.spaceId)).filter((g) => g.lapseRate >= 0.2);
  const maxMin = Math.max(30, ...days.map((d) => d.minutes));
  const total = days.reduce((n, d) => n + d.minutes, 0);
  const others = best ? times.filter((t) => t.part !== best.part && t.answers > 0) : [];
  const otherAcc = others.length ? others.reduce((n, t) => n + t.accuracy * t.answers, 0) / others.reduce((n, t) => n + t.answers, 0) : 0;
  return (
    <>
      <Section title={s.insights.focusTitle} body={s.insights.focusTotal(formatMinutesHuman(total))} testId="insights-focus">
        <div className="flex h-24 items-end gap-1.5" role="img" aria-label={s.insights.focusTitle}>
          {days.map((d) => {
            const label = formatDate(d.day, WEEKDAY_DAY);
            return (
              <div key={d.day} className="flex h-full flex-1 flex-col justify-end" title={s.insights.dayMinutes(label, d.minutes)}>
                <div
                  className={cn("rounded-t-[3px]", d.minutes ? "bg-primary" : "bg-fill")}
                  style={{ height: d.minutes ? `${Math.max(4, (d.minutes / maxMin) * 100)}%` : "3px" }}
                />
              </div>
            );
          })}
        </div>
      </Section>

      <Section title={s.insights.retentionTitle} body={curve.length ? s.insights.retentionBody : undefined} testId="insights-retention">
        {curve.length ? (
          <div className="flex flex-col gap-1.5">
            {curve.map((b) => (
              <div key={b.label} className="grid grid-cols-[88px_1fr_88px] items-center gap-3">
                <span className="text-muted">{b.label}</span>
                <div className="h-2 overflow-hidden rounded-full bg-fill">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${Math.round(b.recall * 100)}%` }} />
                </div>
                <span className="text-end tabular-nums text-fg-secondary">{s.insights.recalled(b.recall, b.n)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-muted">{s.insights.retentionEmpty}</p>
        )}
        {forget.length > 1 && spaceName.get(forget[0].key) && (
          <p className="text-fg-secondary">{s.insights.forgetFastest(spaceName.get(forget[0].key)!, forget[0].lapseRate)}</p>
        )}
      </Section>

      <Section title={s.insights.timeTitle} body={s.insights.timeBody} testId="insights-time">
        <div className="grid grid-cols-4 gap-2">
          {times.map((t) => (
            <div
              key={t.part}
              className={cn("flex flex-col gap-0.5 rounded-tile border px-3 py-2.5", best?.part === t.part ? "border-primary" : "border-border")}
            >
              <span className="font-semibold capitalize">{s.insights.parts[t.part]}</span>
              <span className="text-label text-muted">{s.insights.partHours[t.part]}</span>
              <span className="mt-1 text-title-sm font-semibold tabular-nums">{t.answers ? formatPercent(t.accuracy) : "–"}</span>
              <span className="text-label text-muted">{s.insights.answers(t.answers)}</span>
            </div>
          ))}
        </div>
        <p className="text-fg-secondary">
          {best ? s.insights.timeBest(s.insights.parts[best.part], best.accuracy, otherAcc) : s.insights.timeUnknown}
        </p>
      </Section>

      {sleep && end != null && (
        <Section title={s.insights.sleepTitle} testId="insights-sleep">
          <p className="text-fg-secondary">{s.insights.sleepBody(formatClock(end), formatClock(sleep.at), sleep.cards)}</p>
          <Button size="sm" className="self-start" onClick={() => navigate({ name: "review", spaceId })}>
            {s.insights.sleepReview}
          </Button>
        </Section>
      )}
    </>
  );
}

function MasterySections({ spaceId, attempts }: { spaceId: string; attempts: AttemptRow[] }) {
  const curriculum = useCurriculum(spaceId);
  const levels = useQuery({ queryKey: ["levels", spaceId], queryFn: () => api.topicLevels(spaceId) });
  const abilities = useQuery({ queryKey: ["abilities", spaceId], queryFn: () => api.abilitiesList(spaceId) });
  if (curriculum.isLoading || levels.isLoading || abilities.isLoading) return <Skeleton className="h-56 rounded-card" />;
  const err = curriculum.error ?? levels.error ?? abilities.error;
  if (err)
    return (
      <ErrorState
        title={s.insights.loadError}
        error={err}
        onRetry={() => {
          curriculum.refetch();
          levels.refetch();
          abilities.refetch();
        }}
      />
    );
  const topics = curriculum.data?.topics ?? [];
  if (!topics.length)
    return (
      <Section title={s.insights.masteryTitle}>
        <p className="text-muted">{s.insights.masteryNone}</p>
      </Section>
    );
  const mastery = topicMastery(
    topics.map((t) => t.id),
    levels.data ?? [],
    abilities.data ?? [],
  );
  return (
    <>
      <Section title={s.insights.masteryTitle} body={s.insights.masteryBody} testId="insights-mastery">
        <MasteryMap spaceId={spaceId} topics={topics} mastery={mastery} />
      </Section>
      <MasteryStatusSection spaceId={spaceId} topics={topics} />
      <CalibrationSection attempts={attempts} topics={topics} />
      <PatternsSection spaceId={spaceId} topics={topics} />
      <Readiness topics={topics} mastery={mastery} passMark={PASS_MARK[curriculum.data!.curriculumId] ?? examFor(curriculum.data!.curriculumId)?.passMark} examSpaceId={examFor(curriculum.data!.curriculumId) ? spaceId : undefined} format={examFor(curriculum.data!.curriculumId)} />
    </>
  );
}

type Tone = "unknown" | "weak" | "ok" | "strong";
const toneOf = (p: number | null): Tone => (p == null ? "unknown" : p < 0.5 ? "weak" : p < 0.75 ? "ok" : "strong");
const TONE: Record<Tone, string> = {
  unknown: "border-border bg-surface text-fg-secondary",
  weak: "border-danger-border bg-danger-soft text-fg",
  ok: "border-transparent bg-warn-soft text-fg",
  strong: "border-success-border bg-success-soft text-fg",
};

function MasteryMap({ spaceId, topics, mastery }: { spaceId: string; topics: TopicRef[]; mastery: TopicMastery[] }) {
  const navigate = useUi((st) => st.navigate);
  const box = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<string[]>([]);
  const depth = useMemo(() => prereqDepth(topics), [topics]);
  const byId = new Map(mastery.map((m) => [m.topicId, m]));
  const groups = useMemo(() => {
    const g = new Map<string, TopicRef[][]>();
    for (const t of topics) {
      const cols = g.get(t.group) ?? [];
      const d = depth.get(t.id) ?? 0;
      (cols[d] ??= []).push(t);
      g.set(t.group, cols);
    }
    return [...g].map(([name, cols]) => ({ name, cols: cols.filter(Boolean) }));
  }, [topics, depth]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const draw = () => {
      const base = el.getBoundingClientRect();
      const rect = (id: string) => el.querySelector<HTMLElement>(`[data-topic="${CSS.escape(id)}"]`)?.getBoundingClientRect();
      const paths: string[] = [];
      for (const t of topics)
        for (const p of t.prereqs ?? []) {
          const a = rect(p);
          const b = rect(t.id);
          if (!a || !b) continue;
          const x1 = a.right - base.left;
          const y1 = a.top + a.height / 2 - base.top;
          const x2 = b.left - base.left;
          const y2 = b.top + b.height / 2 - base.top;
          if (x2 <= x1) continue;
          const mx = (x1 + x2) / 2;
          paths.push(`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`);
        }
      setEdges(paths);
    };
    draw();
    const ro = new ResizeObserver(draw);
    ro.observe(el);
    return () => ro.disconnect();
  }, [topics, groups]);

  return (
    <div ref={box} className="relative flex flex-col gap-4">
      <svg className="pointer-events-none absolute inset-0 size-full overflow-visible" aria-hidden>
        {edges.map((d, i) => (
          <path key={i} d={d} fill="none" className="stroke-divider" strokeWidth={1.5} />
        ))}
      </svg>
      {groups.map((g) => (
        <div key={g.name} className="flex flex-col gap-2">
          <span className="text-label font-semibold text-muted">{g.name}</span>
          <div className="flex gap-6">
            {g.cols.map((col, i) => (
              <div key={i} className="flex min-w-0 flex-1 flex-col justify-center gap-2">
                {col.map((t) => {
                  const m = byId.get(t.id);
                  const tone = toneOf(m?.p ?? null);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      data-topic={t.id}
                      data-tone={tone}
                      title={m?.p == null ? s.insights.topicTip(t.title, s.insights.level[tone]) : s.insights.topicTipPct(t.title, s.insights.level[tone], m.p)}
                      onClick={() => navigate({ name: "practice", spaceId, topicKey: t.id, topicTitle: t.title })}
                      className={cn(
                        "relative rounded-item border px-2.5 py-1.5 text-start text-label font-medium leading-snug transition-colors hover:brightness-[0.97] focus-visible:outline-2 focus-visible:outline-ring",
                        TONE[tone],
                      )}
                    >
                      {t.title}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      ))}
      <div className="flex flex-wrap gap-3 text-label text-muted">
        {(["strong", "ok", "weak", "unknown"] as Tone[]).map((t) => (
          <span key={t} className="flex items-center gap-1.5">
            <span className={cn("size-2.5 rounded-[3px] border", TONE[t])} />
            {s.insights.level[t]}
          </span>
        ))}
      </div>
    </div>
  );
}

function Readiness({ topics, mastery, passMark, examSpaceId, format }: { topics: TopicRef[]; mastery: TopicMastery[]; passMark?: number; examSpaceId?: string; format?: ExamFormat | null }) {
  const navigate = useUi((st) => st.navigate);
  const groups = [...new Set(topics.map((t) => t.group))];
  const byId = new Map(mastery.map((m) => [m.topicId, m]));
  return (
    <Section title={s.insights.readinessTitle} body={s.insights.readinessBody} testId="insights-readiness">
      <div className="flex flex-col">
        {groups.map((g) => {
          const ms = topics.filter((t) => t.group === g).map((t) => byId.get(t.id)!);
          const r = readiness(ms, passMark ?? 0.6);
          const sec = format?.sections.find((x) => x.group === g);
          const band = format && sec && r ? scoreBand(format, r.expected, sec.questions.full, 1) : null;
          const known = ms.filter((m) => m.p != null).length;
          return (
            <div key={g} className="flex items-baseline gap-3 py-2 [&+&]:border-t [&+&]:border-divider">
              <span className="w-40 shrink-0 font-semibold">{g}</span>
              {r ? (
                <span className="flex flex-1 flex-wrap gap-x-2 text-fg-secondary">
                  {passMark != null && <span className="font-semibold text-fg tabular-nums">{s.insights.readinessPass(r.pass)}</span>}
                  <span className="tabular-nums">{s.insights.readinessExpected(r.expected)}</span>
                  <span className="text-muted">{s.insights.readinessBasis(r.known, r.total)}</span>
                  {band && format ? <ScoreBandView band={band} format={format} attempts={1} /> : null}
                </span>
              ) : (
                <span className="flex-1 text-muted">{s.insights.readinessLow(known, ms.length)}</span>
              )}
            </div>
          );
        })}
      </div>
      {examSpaceId ? (
        <Button size="sm" className="self-start" onClick={() => navigate({ name: "exam", spaceId: examSpaceId })}>
          {s.exam.takeExam}
        </Button>
      ) : null}
    </Section>
  );
}
