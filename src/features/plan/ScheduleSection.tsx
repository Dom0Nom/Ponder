import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/ipc";
import { loadScheduleContext } from "../../lib/plan/context";
import { todayDate } from "../../lib/plan/clock";
import { invalidatePlans, replanSpaceOnce } from "../../lib/plan/replan";
import { addDays, buildSchedule, completedTopicIds, topicNeed, weekInfo, withRemainingNeed } from "../../lib/plan/schedule";
import { useCourses, useCurriculum, useStudyPlan } from "../../lib/queries";
import { s } from "../../lib/strings";
import type { PlanTask, Space, StudyPlanBundle } from "../../lib/types";
import { cn } from "../../lib/utils";
import { TextSwap } from "../../components/motion/TextSwap";
import { Button } from "../../components/ui/button";
import { ConfirmDialog } from "../../components/ui/dialog";
import { Input, Label } from "../../components/ui/input";
import { ErrorState, Skeleton } from "../../components/ui/misc";
import { toast, toastError } from "../../components/ui/toast";
import { PanelList } from "../space/PanelList";
import { dateLabel, TaskRow } from "./TaskRow";

const DAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DEFAULT_DAYS = [1, 2, 3, 4, 5];

export function ScheduleSection({ space }: { space: Space }) {
  const plan = useStudyPlan(space.id);
  const cur = useCurriculum(space.id);
  const courses = useCourses(space.id);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    replanSpaceOnce(space.id)
      .then((n) => n > 0 && toast(s.plan.schedule.replanned(n)))
      .catch((e) => toastError(s.plan.schedule.saveFailed, e));
  }, [space.id]);

  const loading = plan.isLoading || cur.isLoading || courses.isLoading;
  const error = plan.error ?? cur.error ?? courses.error;
  const hasTopics = !!cur.data || (courses.data ?? []).some((c) => c.lessons.length > 0);

  return (
    <section className="flex flex-col gap-3.5 border-t border-divider pt-4" data-testid="schedule-section">
      <h3 className="text-input font-semibold">{s.plan.schedule.title}</h3>
      {loading && <Skeleton className="h-32 rounded-card" />}
      {error && <ErrorState size="sm" title={s.plan.schedule.loadFailed} error={error} onRetry={() => { plan.refetch(); cur.refetch(); courses.refetch(); }} />}
      {!loading && !error && !plan.data && !hasTopics && <p className="text-muted">{s.plan.schedule.pickFirst}</p>}
      {!loading && !error && !plan.data && hasTopics && <ScheduleForm space={space} curriculumTitle={cur.data?.title ?? null} />}
      {!loading && !error && plan.data && !editing && <PlanView space={space} bundle={plan.data} onEdit={() => setEditing(true)} />}
      {!loading && !error && plan.data && editing && (
        <ScheduleForm space={space} curriculumTitle={cur.data?.title ?? null} existing={plan.data} onDone={() => setEditing(false)} />
      )}
    </section>
  );
}

function ScheduleForm({
  space,
  curriculumTitle,
  existing,
  onDone,
}: {
  space: Space;
  curriculumTitle: string | null;
  existing?: StudyPlanBundle;
  onDone?: () => void;
}) {
  const today = todayDate();
  const [goal, setGoal] = useState(existing?.plan.goal ?? curriculumTitle ?? space.name);
  const [examDate, setExamDate] = useState(existing ? existing.plan.examDate : addDays(today, 28));
  const [hours, setHours] = useState(existing ? String(existing.plan.weeklyMinutes / 60) : "5");
  const [days, setDays] = useState<number[]>(existing?.plan.studyDays ?? DEFAULT_DAYS);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const toggle = (d: number) => setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d]));

  const submit = async () => {
    const e = s.plan.schedule.errors;
    const weeklyMinutes = Math.round(Number(hours) * 60);
    if (!goal.trim()) return setError(e.noGoal);
    if (!(weeklyMinutes > 0)) return setError(e.noMinutes);
    if (days.length === 0) return setError(e.noStudyDays);
    setError(null);
    setBusy(true);
    try {
      const ctx = await loadScheduleContext(space.id);
      const done = (existing?.tasks ?? []).filter((t) => t.doneAt);
      const result = buildSchedule({
        today,
        examDate,
        weeklyMinutes,
        studyDays: days,
        topics: withRemainingNeed(ctx.topics, done),
        lessons: ctx.lessons,
        doneTopicIds: [...ctx.doneTopicIds, ...completedTopicIds(ctx.topics, done)],
        hasCards: ctx.hasCards,
        done,
      });
      if (!result.ok) return setError(e[result.error]);
      await api.saveStudyPlan(space.id, { goal: goal.trim(), examDate, weeklyMinutes, studyDays: days }, false, result.tasks);
      invalidatePlans(space.id);
      onDone?.();
    } catch (err) {
      toastError(s.plan.schedule.saveFailed, err, () => void submit());
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-3.5"
      data-testid="schedule-form"
      noValidate
      onSubmit={(ev) => {
        ev.preventDefault();
        void submit();
      }}
    >
      <div>
        <Label htmlFor="plan-goal">{s.plan.schedule.goal}</Label>
        <Input id="plan-goal" value={goal} maxLength={200} onChange={(ev) => setGoal(ev.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="plan-exam">{existing && !existing.plan.examDate ? s.goal.dateLabel : s.plan.schedule.examDate}</Label>
          <Input id="plan-exam" type="date" min={addDays(today, 1)} value={examDate} onChange={(ev) => setExamDate(ev.target.value)} />
        </div>
        <div>
          <Label htmlFor="plan-hours">{s.plan.schedule.hoursPerWeek}</Label>
          <Input id="plan-hours" type="number" inputMode="decimal" min={0.5} step={0.5} value={hours} onChange={(ev) => setHours(ev.target.value)} />
        </div>
      </div>
      <div>
        <Label className="mb-1.5">{s.plan.schedule.studyDays}</Label>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={s.plan.schedule.studyDays}>
          {DAY_ORDER.map((d) => {
            const on = days.includes(d);
            return (
              <button
                key={d}
                type="button"
                aria-pressed={on}
                aria-label={s.plan.schedule.weekdaysLong[d]}
                onClick={() => toggle(d)}
                className={cn(
                  "h-8 min-w-11 rounded-btn border px-2 text-label font-semibold transition-colors",
                  on ? "border-primary bg-primary text-on-primary" : "border-control bg-surface text-fg-secondary hover:bg-fill",
                )}
              >
                {s.plan.schedule.weekdaysShort[d]}
              </button>
            );
          })}
        </div>
      </div>
      {error && (
        <p role="alert" className="text-label text-danger" data-testid="schedule-error">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" className="flex-1" disabled={busy}>
          {existing ? s.plan.schedule.save : s.plan.schedule.make}
        </Button>
        {onDone && (
          <Button type="button" variant="secondary" onClick={onDone}>
            {s.common.cancel}
          </Button>
        )}
      </div>
    </form>
  );
}

/** The stored plan has no tight flag; a topic scheduled well under what its level asks for means time ran short. */
function useTight(spaceId: string, { plan, tasks }: StudyPlanBundle): boolean {
  const q = useQuery({
    queryKey: ["planTight", spaceId, plan.updatedAt],
    queryFn: async () => {
      const ctx = await loadScheduleContext(spaceId);
      if (ctx.topics.length === 0) return false;
      const skip = new Set(ctx.doneTopicIds);
      return ctx.topics.some((tp) => {
        if (skip.has(tp.id)) return false;
        const need = topicNeed(tp);
        const got = tasks.filter((t) => t.topicId === tp.id && (t.kind === "learn" || t.kind === "practice")).reduce((n, t) => n + t.minutes, 0);
        return got < (need.learn + need.practice) * 0.85;
      });
    },
  });
  return q.data === true;
}

function PlanView({ space, bundle, onEdit }: { space: Space; bundle: StudyPlanBundle; onEdit: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const { plan, tasks } = bundle;
  const today = todayDate();
  const week = weekInfo(plan, today);

  const total = tasks.reduce((n, t) => n + t.minutes, 0);
  const done = tasks.filter((t) => t.doneAt).reduce((n, t) => n + t.minutes, 0);
  const weekStart = addDays(week.start, 7 * (week.current - 1));
  const weekEnd = addDays(weekStart, 6);

  const days = useMemo(() => {
    const by = new Map<string, PlanTask[]>();
    for (const t of tasks) if (t.date >= weekStart && t.date <= weekEnd) by.set(t.date, [...(by.get(t.date) ?? []), t]);
    return [...by.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [tasks, weekStart, weekEnd]);

  const tight = useTight(space.id, bundle);

  return (
    <>
      <div className="flex flex-col gap-1">
        <p className="font-semibold" data-testid="plan-week">
          <TextSwap
            text={
              week.daysLeft == null
                ? `${s.goal.schedule.weekOnly(week.current)} · ${s.goal.schedule.perWeek(String(Math.round(plan.weeklyMinutes / 6) / 10))}`
                : `${s.plan.schedule.weekOf(week.current, week.total)} · ${s.plan.schedule.examIn(week.daysLeft)}`
            }
          />
        </p>
        <p className="truncate text-muted">{plan.goal}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={total}
          aria-valuenow={done}
          aria-label={s.plan.schedule.progress(done, total)}
          className="h-1.5 overflow-hidden rounded-full bg-fill"
        >
          <div className="h-full rounded-full bg-primary transition-[width] duration-(--motion-quick)" style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
        </div>
        <p className="text-label text-muted" data-testid="plan-progress">
          {s.plan.schedule.progress(done, total)}
        </p>
      </div>
      {tight && (
        <p className="text-label text-warn" data-testid="plan-tight">
          {s.plan.schedule.tight}
        </p>
      )}
      {days.length === 0 && <p className="text-muted">{s.plan.schedule.nothingThisWeek}</p>}
      {days.length > 0 && (
        <PanelList inset={14}>
          {days.map(([date, list]) => (
            <div key={date} className="py-2 [&+&]:border-t [&+&]:border-divider" data-testid="plan-day" data-date={date}>
              <p className="text-label font-semibold text-muted">{date === today ? s.plan.schedule.today : dateLabel(date)}</p>
              {list.map((t) => (
                <TaskRow key={t.id} task={t} />
              ))}
            </div>
          ))}
        </PanelList>
      )}
      <div className="flex gap-2">
        <Button variant="secondary" className="flex-1" onClick={onEdit}>
          {s.common.edit}
        </Button>
        <Button variant="secondary" className="flex-1" onClick={() => setDeleting(true)}>
          {s.common.delete}
        </Button>
      </div>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={s.plan.schedule.deleteTitle}
        body={s.plan.schedule.deleteBody}
        confirmLabel={s.common.delete}
        danger
        onConfirm={async () => {
          try {
            await api.deleteStudyPlan(space.id);
            invalidatePlans(space.id);
          } catch (e) {
            toastError(s.errors.generic, e);
          }
        }}
      />
    </>
  );
}
