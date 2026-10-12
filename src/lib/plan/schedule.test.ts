import { describe, expect, it } from "vitest";
import { addDays, buildSchedule, daysBetween, orderTopics, replanIfMissed, weekdayOf, withRemainingNeed, weekInfo, type PlanTopic, type ScheduleInput } from "./schedule";
import type { PlanTask } from "../types";

const TODAY = "2026-10-12"; // Monday
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

const topic = (id: string, level: PlanTopic["level"] = "unknown", prereqs?: string[]): PlanTopic => ({ id, title: `Topic ${id}`, level, prereqs });

function input(over: Partial<ScheduleInput> = {}): ScheduleInput {
  return {
    today: TODAY,
    examDate: addDays(TODAY, 29),
    weeklyMinutes: 420,
    studyDays: ALL_DAYS,
    topics: [topic("a"), topic("b"), topic("c")],
    hasCards: false,
    ...over,
  };
}

function ok(i: ScheduleInput) {
  const r = buildSchedule(i);
  if (!r.ok) throw new Error(r.error);
  return r;
}

function perDay(tasks: { date: string; minutes: number }[]) {
  const m = new Map<string, number>();
  for (const t of tasks) m.set(t.date, (m.get(t.date) ?? 0) + t.minutes);
  return m;
}

describe("buildSchedule", () => {
  it("validates input", () => {
    expect(buildSchedule(input({ examDate: TODAY }))).toEqual({ ok: false, error: "examPast" });
    expect(buildSchedule(input({ examDate: "2026-10-01" }))).toEqual({ ok: false, error: "examPast" });
    expect(buildSchedule(input({ examDate: "soon" }))).toEqual({ ok: false, error: "badDate" });
    expect(buildSchedule(input({ studyDays: [] }))).toEqual({ ok: false, error: "noStudyDays" });
    expect(buildSchedule(input({ weeklyMinutes: 0 }))).toEqual({ ok: false, error: "noMinutes" });
    expect(buildSchedule(input({ topics: [] }))).toEqual({ ok: false, error: "noTopics" });
    expect(buildSchedule(input({ examDate: addDays(TODAY, 3), studyDays: [weekdayOf(addDays(TODAY, 5))] }))).toEqual({ ok: false, error: "noDates" });
  });

  it("only uses study days between today and the day before the exam", () => {
    const exam = addDays(TODAY, 14);
    const r = ok(input({ examDate: exam, studyDays: [1, 3, 5] }));
    expect(r.studyDates.length).toBe(6);
    for (const t of r.tasks) {
      expect([1, 3, 5]).toContain(weekdayOf(t.date));
      expect(t.date >= TODAY && t.date < exam).toBe(true);
    }
  });

  it("never exceeds the daily budget", () => {
    for (const hasCards of [false, true]) {
      for (const weeklyMinutes of [90, 210, 420, 1000]) {
        const topics = Array.from({ length: 12 }, (_, i) => topic(`t${i}`, (["unknown", "weak", "ok", "strong"] as const)[i % 4]));
        const r = ok(input({ topics, weeklyMinutes, hasCards, studyDays: [1, 2, 4, 6] }));
        const budget = Math.round(weeklyMinutes / 4);
        for (const [, m] of perDay(r.tasks)) expect(m).toBeLessThanOrEqual(budget);
        expect(r.dailyMinutes).toBe(budget);
      }
    }
  });

  it("covers every topic when time is enough, with level-based minutes split into learn and practice", () => {
    const r = ok(input({ topics: [topic("u", "unknown"), topic("w", "weak"), topic("o", "ok"), topic("s", "strong")], weeklyMinutes: 1400 }));
    expect(r.tight).toBe(false);
    const sum = (id: string, kind: string) => r.tasks.filter((t) => t.topicId === id && t.kind === kind).reduce((n, t) => n + t.minutes, 0);
    expect([sum("u", "learn"), sum("u", "practice")]).toEqual([54, 36]);
    expect([sum("w", "learn"), sum("w", "practice")]).toEqual([45, 30]);
    expect([sum("o", "learn"), sum("o", "practice")]).toEqual([24, 16]);
    expect([sum("s", "learn"), sum("s", "practice")]).toEqual([0, 15]);
  });

  it("orders topics by prerequisites, weak and unknown first among peers", () => {
    const topics = [topic("calc", "weak", ["alg"]), topic("alg", "strong"), topic("geo", "ok"), topic("stat", "unknown")];
    expect(orderTopics(topics).map((t) => t.id)).toEqual(["stat", "geo", "alg", "calc"]);
    const r = ok(input({ topics, weeklyMinutes: 3000 }));
    const first = (id: string) => r.tasks.findIndex((t) => t.topicId === id);
    expect(first("alg")).toBeLessThan(first("calc"));
    expect(first("stat")).toBeLessThan(first("geo"));
  });

  it("survives prerequisite cycles and unknown prerequisites", () => {
    const out = orderTopics([topic("a", "ok", ["b"]), topic("b", "ok", ["a"]), topic("c", "ok", ["zzz"])]);
    expect(out.map((t) => t.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("reserves the last ~15% of study days for review and puts a mock exam on the last day", () => {
    const r = ok(input({ examDate: addDays(TODAY, 21), topics: [topic("a"), topic("b")], weeklyMinutes: 700 }));
    expect(r.studyDates.length).toBe(21);
    const reserve = 4;
    const reserveDates = r.studyDates.slice(-reserve);
    const learnDates = r.studyDates.slice(0, -reserve);
    for (const t of r.tasks) {
      if (reserveDates.includes(t.date)) expect(["review", "mock"]).toContain(t.kind);
    }
    expect(r.tasks.filter((t) => t.kind === "mock")).toHaveLength(1);
    expect(r.tasks.find((t) => t.kind === "mock")!.date).toBe(r.studyDates[20]);
    expect(r.tasks.some((t) => t.kind === "learn" && learnDates.includes(t.date))).toBe(true);
  });

  it("clamps the reserve to 1..7 days and skips it with fewer than 4 study days", () => {
    const short = ok(input({ examDate: addDays(TODAY, 3) }));
    expect(short.studyDates.length).toBe(3);
    expect(short.tasks.some((t) => t.kind === "mock" || t.kind === "review")).toBe(false);
    const four = ok(input({ examDate: addDays(TODAY, 4) }));
    expect(four.tasks.filter((t) => t.date === four.studyDates[3]).every((t) => t.kind === "review" || t.kind === "mock")).toBe(true);
    expect(four.tasks.filter((t) => t.date === four.studyDates[2]).some((t) => t.kind === "learn" || t.kind === "practice")).toBe(true);
    const long = ok(input({ examDate: addDays(TODAY, 120), weeklyMinutes: 700 }));
    const reserveCount = long.studyDates.filter((d) => long.tasks.filter((t) => t.date === d).every((t) => t.kind === "review" || t.kind === "mock")).length;
    expect(reserveCount).toBeGreaterThanOrEqual(7);
    const lastLearn = long.tasks.filter((t) => t.kind === "learn" || t.kind === "practice").map((t) => t.date).sort().pop()!;
    expect(long.studyDates.filter((d) => d > lastLearn).length).toBeGreaterThanOrEqual(7);
    expect(long.studyDates.indexOf(long.tasks.find((t) => t.kind === "mock")!.date)).toBe(119);
  });

  it("adds a 10-15 minute flashcard review each study day when there are cards", () => {
    const r = ok(input({ hasCards: true, examDate: addDays(TODAY, 10) }));
    for (const d of r.studyDates) {
      const rev = r.tasks.filter((t) => t.date === d && t.kind === "review" && t.topicId === null);
      expect(rev).toHaveLength(1);
      expect(rev[0].minutes).toBeGreaterThanOrEqual(10);
      expect(rev[0].minutes).toBeLessThanOrEqual(15);
    }
    expect(ok(input({ hasCards: false })).tasks.some((t) => t.topicId === null && t.kind === "review")).toBe(false);
  });

  it("scales topics down proportionally and reports tight when time is short", () => {
    const topics = Array.from({ length: 8 }, (_, i) => topic(`t${i}`));
    const r = ok(input({ topics, examDate: addDays(TODAY, 7), weeklyMinutes: 300 }));
    expect(r.tight).toBe(true);
    const work = r.tasks.filter((t) => t.kind === "learn" || t.kind === "practice");
    expect(work.length).toBeGreaterThan(0);
    for (const t of work) expect(t.minutes).toBeGreaterThanOrEqual(10);
    for (const [, m] of perDay(r.tasks)) expect(m).toBeLessThanOrEqual(43);
    const learnA = r.tasks.filter((t) => t.topicId === "t0" && t.kind === "learn").reduce((n, t) => n + t.minutes, 0);
    const learnB = r.tasks.filter((t) => t.topicId === "t1" && t.kind === "learn").reduce((n, t) => n + t.minutes, 0);
    expect(learnA).toBe(learnB);
    expect(learnA).toBeLessThan(54);
  });

  it("does not report tight when everything fits", () => {
    expect(ok(input({ weeklyMinutes: 1400 })).tight).toBe(false);
  });

  it("uses course lessons as topics when there are no curriculum topics", () => {
    const r = ok(input({ topics: [], lessons: [{ id: "l1", title: "Chapter 1" }, { id: "l2", title: "Chapter 2" }], weeklyMinutes: 1000 }));
    const ids = [...new Set(r.tasks.filter((t) => t.kind === "learn").map((t) => t.topicId))];
    expect(ids).toEqual(["l1", "l2"]);
    expect(r.tasks.find((t) => t.topicId === "l1")!.title).toBe("Learn: Chapter 1");
  });

  it("skips topics that are already done", () => {
    const r = ok(input({ doneTopicIds: ["a"], weeklyMinutes: 1000 }));
    expect(r.tasks.some((t) => t.topicId === "a" && (t.kind === "learn" || t.kind === "practice"))).toBe(false);
  });

  it("is deterministic and numbers tasks within a day", () => {
    const a = ok(input({ hasCards: true }));
    const b = ok(input({ hasCards: true }));
    expect(a).toEqual(b);
    const first = a.tasks.filter((t) => t.date === a.studyDates[0]);
    expect(first.map((t) => t.ord)).toEqual(first.map((_, i) => i));
  });
});

let seq = 0;
function stored(tasks: { date: string; kind?: PlanTask["kind"]; topicId?: string | null; minutes?: number; done?: boolean; title?: string }[]): PlanTask[] {
  return tasks.map((t) => ({
    id: `id${seq++}`,
    spaceId: "sp",
    date: t.date,
    ord: 0,
    kind: t.kind ?? "learn",
    topicId: t.topicId === undefined ? "a" : t.topicId,
    title: t.title ?? "Learn: Topic a",
    minutes: t.minutes ?? 30,
    doneAt: t.done ? 1 : null,
  }));
}

describe("withRemainingNeed", () => {
  it("subtracts finished minutes per kind and leaves untouched topics alone", () => {
    const a = topic("a");
    const b = topic("b");
    const [ra, rb] = withRemainingNeed([a, b], [
      { date: TODAY, kind: "learn", minutes: 30, topicId: "a" },
      { date: TODAY, kind: "practice", minutes: 100, topicId: "a" },
    ]);
    expect(ra.need).toEqual({ learn: 54 - 30, practice: 0 });
    expect(rb).toBe(b);
  });

  it("schedules only the remaining minutes when editing a partly done plan", () => {
    const done = [{ date: TODAY, kind: "learn" as const, minutes: 54, topicId: "a" }];
    const r = ok(input({ topics: withRemainingNeed([topic("a")], done), done, examDate: addDays(TODAY, 29) }));
    expect(r.tasks.filter((t) => t.topicId === "a" && t.kind === "learn")).toHaveLength(0);
    expect(r.tasks.filter((t) => t.topicId === "a" && t.kind === "practice").reduce((n, t) => n + t.minutes, 0)).toBe(36);
  });
});

describe("replanIfMissed", () => {
  const plan = { goal: "g", examDate: addDays(TODAY, 29), weeklyMinutes: 420, studyDays: ALL_DAYS };
  const ctx = { topics: [topic("a", "weak"), topic("b", "ok")], hasCards: false };

  it("does nothing when no open task is in the past", () => {
    const tasks = stored([{ date: "2026-10-10", done: true }, { date: TODAY }, { date: "2026-10-14" }]);
    expect(replanIfMissed(plan, tasks, TODAY, ctx)).toBeNull();
  });

  it("moves missed work from today on and counts it", () => {
    const tasks = stored([
      { date: "2026-10-09", minutes: 45 },
      { date: "2026-10-10", topicId: "b", minutes: 24, title: "Learn: Topic b" },
      { date: "2026-10-20", topicId: "b", kind: "practice", minutes: 16, title: "Practice: Topic b" },
    ]);
    const r = replanIfMissed(plan, tasks, TODAY, ctx)!;
    expect(r.moved).toBe(2);
    expect(r.tasks.every((t) => t.date >= TODAY && t.date < plan.examDate)).toBe(true);
    const sum = (id: string, kind: string) => r.tasks.filter((t) => t.topicId === id && t.kind === kind).reduce((n, t) => n + t.minutes, 0);
    expect(sum("a", "learn")).toBe(45);
    expect(sum("b", "learn")).toBe(24);
    expect(sum("b", "practice")).toBe(16);
  });

  it("keeps done tasks out of the rebuild and counts today's finished minutes against the budget", () => {
    const tasks = stored([
      { date: "2026-10-09", done: true, minutes: 30 },
      { date: TODAY, done: true, minutes: 50 },
      { date: "2026-10-10", minutes: 600, title: "Learn: Topic a" },
    ]);
    const r = replanIfMissed({ ...plan, weeklyMinutes: 420 }, tasks, TODAY, ctx)!;
    expect(r.moved).toBe(1);
    expect(r.tasks.filter((t) => t.date === TODAY).reduce((n, t) => n + t.minutes, 0)).toBeLessThanOrEqual(60 - 50);
    expect(r.tasks.filter((t) => t.topicId === "a" && t.kind === "learn").reduce((n, t) => n + t.minutes, 0)).toBeGreaterThan(0);
    for (const [d, m] of perDay(r.tasks)) expect(m + (d === TODAY ? 50 : 0)).toBeLessThanOrEqual(60);
  });

  it("still moves missed review or mock tasks when no topic work is left", () => {
    const tasks = stored([{ date: "2026-10-10", kind: "review", topicId: null, title: "Review flashcards", minutes: 15 }]);
    const r = replanIfMissed(plan, tasks, TODAY, { ...ctx, hasCards: true })!;
    expect(r.moved).toBe(1);
    expect(r.tasks.some((t) => t.kind === "learn" || t.kind === "practice")).toBe(false);
    expect(r.tasks.every((t) => t.date >= TODAY)).toBe(true);
  });

  it("gives up once the exam is today or past", () => {
    const tasks = stored([{ date: "2026-10-09" }]);
    expect(replanIfMissed({ ...plan, examDate: TODAY }, tasks, TODAY, ctx)).toBeNull();
  });
});

describe("dates", () => {
  it("does calendar math without time zones", () => {
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(daysBetween("2026-10-12", "2026-11-12")).toBe(31);
    expect(weekdayOf("2026-10-12")).toBe(1);
  });

  it("numbers plan weeks", () => {
    const created = new Date(2026, 9, 12, 12).getTime();
    const plan = { createdAt: created, examDate: "2026-11-12" };
    expect(weekInfo(plan, "2026-10-12")).toMatchObject({ current: 1, total: 5, daysLeft: 31 });
    expect(weekInfo(plan, "2026-10-19").current).toBe(2);
    expect(weekInfo(plan, "2026-12-01").current).toBe(5);
  });
});
