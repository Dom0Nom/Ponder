import { describe, expect, it } from "vitest";
import { buildSchedule, milestoneAfter, replanIfMissed, weekInfo, type PlanTopic, type ScheduleInput } from "./schedule";
import type { PlanTask } from "../types";

const TODAY = "2026-10-12"; // Monday
const t = (id: string, group: string, level: PlanTopic["level"] = "unknown"): PlanTopic => ({ id, title: `Topic ${id}`, level, group });

const input = (over: Partial<ScheduleInput> = {}): ScheduleInput => ({
  today: TODAY,
  examDate: "",
  weeklyMinutes: 300,
  studyDays: [1, 3, 5],
  topics: [t("a", "Basics"), t("b", "Basics"), t("c", "Advanced")],
  hasCards: false,
  ...over,
});

function ok(i: ScheduleInput) {
  const r = buildSchedule(i);
  if (!r.ok) throw new Error(r.error);
  return r;
}

describe("schedule without a date", () => {
  it("runs on weekly minutes and never exceeds the daily budget", () => {
    const r = ok(input());
    const by = new Map<string, number>();
    for (const x of r.tasks) by.set(x.date, (by.get(x.date) ?? 0) + x.minutes);
    expect(r.dailyMinutes).toBe(100);
    expect(Math.max(...by.values())).toBeLessThanOrEqual(100);
    expect(r.tasks.every((x) => [1, 3, 5].includes(new Date(`${x.date}T00:00:00Z`).getUTCDay()))).toBe(true);
  });

  it("covers every topic fully: no reserve days, no mock exam, not tight", () => {
    const r = ok(input());
    expect(r.tight).toBe(false);
    expect(r.tasks.some((x) => x.kind === "mock")).toBe(false);
    const need = r.tasks.filter((x) => x.kind === "learn" || x.kind === "practice").reduce((n, x) => n + x.minutes, 0);
    expect(need).toBe(3 * 90);
  });

  it("ends each group with a milestone", () => {
    const r = ok(input());
    const ms = r.tasks.filter((x) => x.kind === "milestone");
    expect(ms.map((x) => x.topicId)).toEqual(["b", "c"]);
    const lastB = r.tasks.findLastIndex((x) => x.topicId === "b" && x.kind !== "milestone");
    expect(r.tasks.indexOf(ms[0])).toBeGreaterThan(lastB);
  });

  it("a plan with more weekly time finishes sooner", () => {
    const slow = ok(input({ weeklyMinutes: 150 }));
    const fast = ok(input({ weeklyMinutes: 600 }));
    expect(fast.tasks.at(-1)!.date < slow.tasks.at(-1)!.date).toBe(true);
  });

  it("puts a milestone every few topics when nothing is grouped", () => {
    const flat = Array.from({ length: 9 }, (_, i) => t(`t${i}`, "x"));
    expect([...milestoneAfter(flat).keys()]).toEqual(["t3", "t7", "t8"]);
  });

  it("skips topics that are already known", () => {
    const r = ok(input({ doneTopicIds: ["a"] }));
    expect(r.tasks.some((x) => x.topicId === "a")).toBe(false);
  });

  it("still rejects a missing study day or minutes", () => {
    expect(buildSchedule(input({ studyDays: [] }))).toEqual({ ok: false, error: "noStudyDays" });
    expect(buildSchedule(input({ weeklyMinutes: 0 }))).toEqual({ ok: false, error: "noMinutes" });
  });

  it("week info has no total or countdown", () => {
    const w = weekInfo({ createdAt: new Date(2026, 9, 12).getTime(), examDate: "" }, "2026-10-27");
    expect(w).toMatchObject({ total: 0, current: 3, daysLeft: null });
  });

  it("re-plans missed tasks without a date", () => {
    const first = ok(input());
    const tasks: PlanTask[] = first.tasks.map((x, i) => ({ ...x, id: `p${i}`, spaceId: "s", doneAt: null }));
    const plan = { goal: "Robot arm", examDate: "", weeklyMinutes: 300, studyDays: [1, 3, 5] };
    const r = replanIfMissed(plan, tasks, "2026-10-19", { topics: [t("a", "Basics"), t("b", "Basics"), t("c", "Advanced")], lessons: [], hasCards: false });
    expect(r).not.toBeNull();
    expect(r!.tasks.every((x) => x.date >= "2026-10-19")).toBe(true);
  });
});
