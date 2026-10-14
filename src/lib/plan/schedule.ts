import { s } from "../strings";
import type { NewPlanTask, PlanFields, PlanTask, PlanTaskKind, StudyPlan, TopicLevelValue } from "../types";

const DAY_MS = 86_400_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const parse = (d: string) => {
  const [y, m, day] = d.split("-").map(Number);
  return Date.UTC(y, m - 1, day);
};
const fmt = (t: number) => new Date(t).toISOString().slice(0, 10);

export const isDate = (d: string) => DATE_RE.test(d) && fmt(parse(d)) === d;
export const addDays = (d: string, n: number) => fmt(parse(d) + n * DAY_MS);
export const daysBetween = (a: string, b: string) => Math.round((parse(b) - parse(a)) / DAY_MS);
export const weekdayOf = (d: string) => new Date(parse(d)).getUTCDay();

export function localDate(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Total plan weeks, and which one `today` falls in (both 1-based). */
export function weekInfo(plan: Pick<StudyPlan, "createdAt" | "examDate">, today: string) {
  const start = localDate(plan.createdAt);
  if (!plan.examDate) return { start, total: 0, current: Math.max(1, Math.floor(daysBetween(start, today) / 7) + 1), daysLeft: null as number | null };
  const total = Math.max(1, Math.ceil((daysBetween(start, plan.examDate) + 1) / 7));
  const current = Math.min(total, Math.max(1, Math.floor(daysBetween(start, today) / 7) + 1));
  return { start, total, current, daysLeft: daysBetween(today, plan.examDate) as number | null };
}

export const LEVEL_MINUTES: Record<TopicLevelValue, number> = { unknown: 90, weak: 75, ok: 40, strong: 15 };
const LEVEL_RANK: Record<TopicLevelValue, number> = { unknown: 0, weak: 0, ok: 1, strong: 2 };
const LEARN_SHARE = 0.6;
const MIN_TASK = 10;
const MOCK_MINUTES = 90;
const MILESTONE_MINUTES = 20;
const MILESTONE_EVERY = 4;
const MAX_STUDY_DAYS = 7 * 104;

export interface PlanTopic {
  id: string;
  title: string;
  level: TopicLevelValue;
  prereqs?: string[];
  /** topics of one group end in a milestone when the plan has no date */
  group?: string;
  /** remaining minutes per kind; replaces the level-based estimate (used when re-planning) */
  need?: { learn: number; practice: number };
}

export interface DoneTask {
  date: string;
  kind: PlanTaskKind;
  minutes: number;
  topicId?: string | null;
}

export interface ScheduleInput {
  /** YYYY-MM-DD, local */
  today: string;
  /** empty or missing: no date, the schedule runs on weekly minutes and milestones */
  examDate?: string | null;
  weeklyMinutes: number;
  /** 0 = Sunday … 6 = Saturday */
  studyDays: number[];
  topics: PlanTopic[];
  lessons?: { id: string; title: string }[];
  doneTopicIds?: string[];
  hasCards: boolean;
  /** tasks already done; they use up that day's time and keep a day's review from repeating */
  done?: DoneTask[];
}

export type ScheduleError = "noTopics" | "examPast" | "badDate" | "noStudyDays" | "noMinutes" | "noDates";

export type ScheduleResult =
  | { ok: true; tasks: NewPlanTask[]; tight: boolean; studyDates: string[]; dailyMinutes: number }
  | { ok: false; error: ScheduleError };

export function topicNeed(t: PlanTopic): { learn: number; practice: number } {
  if (t.need) return t.need;
  const total = LEVEL_MINUTES[t.level];
  const learn = t.level === "strong" ? 0 : Math.round(total * LEARN_SHARE);
  return { learn, practice: total - learn };
}

/** Topics with the minutes already finished subtracted, so editing a plan doesn't schedule that work again. */
export function withRemainingNeed(topics: PlanTopic[], done: DoneTask[]): PlanTopic[] {
  return topics.map((t) => {
    const mine = done.filter((d) => d.topicId === t.id && (d.kind === "learn" || d.kind === "practice"));
    if (mine.length === 0) return t;
    const need = topicNeed(t);
    const spent = (kind: "learn" | "practice") => mine.filter((d) => d.kind === kind).reduce((n, d) => n + d.minutes, 0);
    return { ...t, need: { learn: Math.max(0, need.learn - spent("learn")), practice: Math.max(0, need.practice - spent("practice")) } };
  });
}

/** Topics in prerequisite order; among those ready at the same time, weak/unknown come first. */
export function orderTopics(topics: PlanTopic[]): PlanTopic[] {
  const ids = new Set(topics.map((t) => t.id));
  const placed = new Set<string>();
  const out: PlanTopic[] = [];
  const index = new Map(topics.map((t, i) => [t.id, i]));
  while (out.length < topics.length) {
    const ready = topics.filter((t) => !placed.has(t.id) && (t.prereqs ?? []).every((p) => !ids.has(p) || placed.has(p) || p === t.id));
    const pool = ready.length ? ready : topics.filter((t) => !placed.has(t.id));
    const next = [...pool].sort((a, b) => (ready.length ? LEVEL_RANK[a.level] - LEVEL_RANK[b.level] : 0) || index.get(a.id)! - index.get(b.id)!)[0];
    placed.add(next.id);
    out.push(next);
  }
  return out;
}

/** Topics whose finished tasks already cover what their level asks for. */
export function completedTopicIds(topics: PlanTopic[], done: DoneTask[]): string[] {
  return topics
    .filter((t) => {
      const need = topicNeed(t);
      const got = done.filter((d) => d.topicId === t.id).reduce((n, d) => n + d.minutes, 0);
      return got >= (need.learn + need.practice) * 0.9;
    })
    .map((t) => t.id);
}

interface Item {
  topic: PlanTopic;
  kind: "learn" | "practice" | "milestone";
  minutes: number;
  label?: string;
}

/** One milestone after the last topic of each group; ungrouped topics get one every few topics and at the end. */
export function milestoneAfter(open: PlanTopic[]): Map<string, string> {
  const out = new Map<string, string>();
  const grouped = new Set(open.map((t) => t.group ?? "")).size > 1;
  open.forEach((t, i) => {
    const next = open[i + 1];
    if (grouped) {
      if (!next || (next.group ?? "") !== (t.group ?? "")) out.set(t.id, t.group || t.title);
    } else if (!next || (i + 1) % MILESTONE_EVERY === 0) out.set(t.id, t.title);
  });
  return out;
}

export function buildSchedule(input: ScheduleInput): ScheduleResult {
  const { today, weeklyMinutes } = input;
  const examDate = input.examDate || "";
  const dateless = !examDate;
  const studyDays = [...new Set(input.studyDays)].filter((d) => d >= 0 && d <= 6);
  if (!isDate(today) || (!dateless && !isDate(examDate))) return { ok: false, error: "badDate" };
  if (!dateless && daysBetween(today, examDate) <= 0) return { ok: false, error: "examPast" };
  if (studyDays.length === 0) return { ok: false, error: "noStudyDays" };
  if (!(weeklyMinutes > 0)) return { ok: false, error: "noMinutes" };

  const base: PlanTopic[] = input.topics.length
    ? input.topics
    : (input.lessons ?? []).map((l) => ({ id: l.id, title: l.title, level: "unknown" as const }));
  if (base.length === 0) return { ok: false, error: "noTopics" };

  const budget = Math.max(1, Math.round(weeklyMinutes / studyDays.length));
  const done = input.done ?? [];
  const usedOn = (d: string) => done.filter((x) => x.date === d).reduce((n, x) => n + x.minutes, 0);
  const hasDoneReview = (d: string) => done.some((x) => x.date === d && x.kind === "review");
  const reviewMin = input.hasCards ? Math.min(Math.min(15, Math.max(10, Math.round(budget * 0.2))), Math.floor(budget / 2)) : 0;
  const dailyReview = reviewMin >= MIN_TASK ? reviewMin : 0;
  const reviewFor = (d: string) => (dailyReview && !hasDoneReview(d) ? dailyReview : 0);
  const capFor = (d: string) => Math.max(0, budget - usedOn(d) - reviewFor(d));

  const doneIds = new Set(input.doneTopicIds ?? []);
  const open = orderTopics(base.filter((t) => !doneIds.has(t.id)));
  const marks = dateless ? milestoneAfter(open) : new Map<string, string>();

  let items: Item[] = open.flatMap((topic) => {
    const need = topicNeed(topic);
    const list: Item[] = [
      { topic, kind: "learn" as const, minutes: need.learn },
      { topic, kind: "practice" as const, minutes: need.practice },
    ].filter((i) => i.minutes > 0);
    if (marks.has(topic.id)) list.push({ topic, kind: "milestone", minutes: MILESTONE_MINUTES, label: marks.get(topic.id) });
    return list;
  });

  const dates: string[] = [];
  let tightHorizon = false;
  if (dateless) {
    const want = items.reduce((n, i) => n + i.minutes, 0) + marks.size * MILESTONE_MINUTES;
    let got = 0;
    for (let d = today; got < want; d = addDays(d, 1)) {
      if (!studyDays.includes(weekdayOf(d))) continue;
      if (dates.length >= MAX_STUDY_DAYS) {
        tightHorizon = true;
        break;
      }
      dates.push(d);
      got += capFor(d);
    }
    if (dates.length === 0) dates.push(today);
  } else for (let d = today; d < examDate; d = addDays(d, 1)) if (studyDays.includes(weekdayOf(d))) dates.push(d);
  if (dates.length === 0) return { ok: false, error: "noDates" };

  const reserve = dateless || dates.length < 4 ? 0 : Math.min(7, Math.max(1, Math.ceil(dates.length * 0.15)));
  const learnDates = dates.slice(0, dates.length - reserve);
  const reserveDates = dates.slice(dates.length - reserve);

  const capacity = learnDates.reduce((n, d) => n + capFor(d), 0);
  const needed = items.reduce((n, i) => n + i.minutes, 0);
  let tight = tightHorizon;
  if (needed > capacity) {
    tight = true;
    const f = capacity / needed;
    items = items.map((i) => (i.kind === "milestone" ? i : { ...i, minutes: Math.min(i.minutes, Math.max(MIN_TASK, Math.floor(i.minutes * f))) }));
  }

  const byDate = new Map<string, Omit<NewPlanTask, "date" | "ord">[]>(dates.map((d) => [d, []]));
  const left = new Map(learnDates.map((d) => [d, capFor(d)]));
  let di = 0;
  outer: for (const item of items) {
    let remaining = item.minutes;
    while (remaining > 0) {
      while (di < learnDates.length && (left.get(learnDates[di]) ?? 0) <= 0) di++;
      if (di >= learnDates.length) {
        tight = true;
        break outer;
      }
      const d = learnDates[di];
      const room = left.get(d)!;
      if (item.kind === "milestone" && room < remaining) {
        left.set(d, 0);
        continue;
      }
      // a split never leaves a piece under the minimum on either side
      const take = room >= remaining ? remaining : Math.min(room, remaining - MIN_TASK);
      if (take < MIN_TASK && take < remaining) {
        left.set(d, 0);
        continue;
      }
      const list = byDate.get(d)!;
      const last = list[list.length - 1];
      if (last && last.topicId === item.topic.id && last.kind === item.kind) last.minutes += take;
      else
        list.push({
          kind: item.kind,
          topicId: item.topic.id,
          title:
            item.kind === "milestone"
              ? s.goal.schedule.milestone(item.label ?? item.topic.title)
              : item.kind === "learn"
                ? s.plan.schedule.tasks.learn(item.topic.title)
                : s.plan.schedule.tasks.practice(item.topic.title),
          minutes: take,
        });
      left.set(d, left.get(d)! - take);
      remaining -= take;
    }
  }

  const reviewTopics = open.length ? open : orderTopics(base);
  const byWeakness = [...reviewTopics].sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level]);
  reserveDates.forEach((d, k) => {
    const cap = capFor(d);
    const list = byDate.get(d)!;
    const isLast = k === reserveDates.length - 1;
    const mock = isLast ? Math.min(cap, MOCK_MINUTES) : 0;
    const rest = cap - mock;
    if (rest > 0) {
      const t = byWeakness[k % byWeakness.length];
      list.push({ kind: "review", topicId: t.id, title: s.plan.schedule.tasks.review(t.title), minutes: rest });
    }
    if (mock > 0) list.push({ kind: "mock", topicId: null, title: s.plan.schedule.tasks.mock, minutes: mock });
  });

  const tasks: NewPlanTask[] = [];
  for (const d of dates) {
    const list = byDate.get(d)!;
    const review = reviewFor(d);
    if (review) list.push({ kind: "review", topicId: null, title: s.plan.schedule.tasks.cards, minutes: review });
    list.forEach((t, ord) => tasks.push({ ...t, date: d, ord }));
  }
  return { ok: true, tasks, tight, studyDates: dates, dailyMinutes: budget };
}

export interface ReplanContext {
  topics: PlanTopic[];
  lessons?: { id: string; title: string }[];
  hasCards: boolean;
}

export interface Replan {
  /** undone tasks that were dated before today */
  moved: number;
  tasks: NewPlanTask[];
  tight: boolean;
}

export function missedTasks(tasks: Pick<PlanTask, "date" | "doneAt">[], today: string) {
  return tasks.filter((t) => !t.doneAt && t.date < today);
}

/**
 * If any open task is dated before `today`, rebuilds everything that is still open from today on.
 * Returns null when nothing was missed or the exam can no longer be scheduled.
 */
export function replanIfMissed(plan: PlanFields, tasks: PlanTask[], today: string, ctx: ReplanContext): Replan | null {
  const missed = missedTasks(tasks, today);
  if (missed.length === 0) return null;

  const openTasks = tasks.filter((t) => !t.doneAt);
  const need = new Map<string, { learn: number; practice: number; title: string }>();
  for (const t of openTasks) {
    if (!t.topicId || (t.kind !== "learn" && t.kind !== "practice")) continue;
    const n = need.get(t.topicId) ?? { learn: 0, practice: 0, title: t.title };
    n[t.kind] += t.minutes;
    need.set(t.topicId, n);
  }
  const known = new Map([...ctx.topics, ...(ctx.lessons ?? []).map((l) => ({ id: l.id, title: l.title, level: "unknown" as const }))].map((t) => [t.id, t as PlanTopic]));
  const topics: PlanTopic[] = [...need.entries()].map(([id, n]) => {
    const t = known.get(id);
    return { id, title: t?.title ?? n.title, level: t?.level ?? "unknown", prereqs: t?.prereqs, group: t?.group, need: { learn: n.learn, practice: n.practice } };
  });

  const allIds = [...ctx.topics.map((x) => x.id), ...(ctx.lessons ?? []).map((l) => l.id)];
  const result = buildSchedule({
    today,
    examDate: plan.examDate || null,
    weeklyMinutes: plan.weeklyMinutes,
    studyDays: plan.studyDays,
    topics: topics.length ? topics : ctx.topics,
    lessons: ctx.lessons,
    doneTopicIds: topics.length ? [] : allIds,
    hasCards: ctx.hasCards,
    done: tasks.filter((t) => t.doneAt),
  });
  if (!result.ok) return null;
  return { moved: missed.length, tasks: result.tasks, tight: result.tight };
}
