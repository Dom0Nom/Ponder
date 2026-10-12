import { describe, expect, it } from "vitest";
import type { InsightsActivity, ReviewRow } from "../types";
import {
  bestStudyTime,
  clock,
  dailyMinutes,
  forgetFastest,
  prereqDepth,
  readiness,
  retentionCurve,
  reviewBeforeSleep,
  studyTimes,
  topicMastery,
  usualEnd,
} from "./analytics";

const DAY = 86_400_000;
const at = (y: number, m: number, d: number, h: number, min = 0) => new Date(y, m, d, h, min).getTime();
const rv = (cardId: string, reviewedAt: number, rating: number, sourceId: string | null = null): ReviewRow => ({
  cardId,
  spaceId: "s",
  sourceId,
  rating,
  reviewedAt,
});
const empty: InsightsActivity = { reviews: [], focus: [], attempts: [] };

describe("retention", () => {
  it("buckets reviews by the gap since the card's previous review", () => {
    const t0 = at(2026, 9, 1, 10);
    const reviews = [
      rv("a", t0, 3),
      rv("a", t0 + 2 * DAY, 3),
      rv("a", t0 + 10 * DAY, 1),
      rv("b", t0, 3),
      rv("b", t0 + 2.5 * DAY, 1),
      rv("b", t0 + 3 * DAY, 3),
    ];
    const curve = retentionCurve(reviews);
    expect(curve.map((b) => [b.label, b.n, b.recall])).toEqual([
      ["< 1 day", 1, 1],
      ["1–3 days", 2, 0.5],
      ["1–2 weeks", 1, 0],
    ]);
  });

  it("ranks sources by lapses after a day, with a minimum sample", () => {
    const t0 = at(2026, 9, 1, 10);
    const reviews: ReviewRow[] = [];
    for (let i = 0; i < 6; i++) {
      reviews.push(rv(`x${i}`, t0, 3, "hard"), rv(`x${i}`, t0 + 2 * DAY, i < 4 ? 1 : 3, "hard"));
      reviews.push(rv(`y${i}`, t0, 3, "easy"), rv(`y${i}`, t0 + 2 * DAY, i < 1 ? 1 : 3, "easy"));
    }
    reviews.push(rv("z", t0, 3, "tiny"), rv("z", t0 + 2 * DAY, 1, "tiny"));
    const g = forgetFastest(reviews, (r) => r.sourceId);
    expect(g.map((x) => x.key)).toEqual(["hard", "easy"]);
    expect(g[0].lapseRate).toBeCloseTo(4 / 6);
  });
});

describe("study times", () => {
  it("compares accuracy per part of the day and needs a clear lead", () => {
    const a: InsightsActivity = { ...empty, attempts: [] };
    for (let i = 0; i < 20; i++) {
      a.attempts.push({ spaceId: "s", topicKey: "t", correct: i < 18, createdAt: at(2026, 9, 1 + (i % 7), 9) });
      a.attempts.push({ spaceId: "s", topicKey: "t", correct: i < 12, createdAt: at(2026, 9, 1 + (i % 7), 21) });
    }
    const stats = studyTimes(a);
    expect(stats.find((s) => s.part === "morning")).toMatchObject({ answers: 20, accuracy: 0.9 });
    expect(bestStudyTime(stats)?.part).toBe("morning");
    a.attempts = a.attempts.map((x) => ({ ...x, correct: true }));
    expect(bestStudyTime(studyTimes(a))).toBeNull();
    expect(bestStudyTime(studyTimes(empty))).toBeNull();
  });

  it("finds when study usually ends, counting after-midnight as the evening before", () => {
    const now = at(2026, 9, 12, 12);
    const focus = [
      { spaceId: "s", startedAt: at(2026, 9, 8, 21, 30), focusMs: 25 * 60_000 },
      { spaceId: "s", startedAt: at(2026, 9, 9, 22, 0), focusMs: 30 * 60_000 },
      { spaceId: "s", startedAt: at(2026, 9, 11, 0, 10), focusMs: 20 * 60_000 },
    ];
    const end = usualEnd({ ...empty, focus }, now);
    expect(clock(end!)).toBe("22:30");
    expect(reviewBeforeSleep(end, 40)).toEqual({ at: 22 * 60, cards: 20 });
    expect(reviewBeforeSleep(end, 0)).toBeNull();
    expect(reviewBeforeSleep(15 * 60, 10)).toBeNull();
    expect(usualEnd({ ...empty, focus: focus.slice(0, 2) }, now)).toBeNull();
  });

  it("sums focus minutes per day", () => {
    const now = at(2026, 9, 12, 12);
    const d = dailyMinutes({ ...empty, focus: [{ spaceId: null, startedAt: at(2026, 9, 11, 9), focusMs: 50 * 60_000 }] }, now, 3);
    expect(d.map((x) => x.minutes)).toEqual([0, 50, 0]);
  });
});

describe("dailyMinutes across DST", () => {
  it("starts every day at local midnight", () => {
    for (const month of [2, 9, 10]) {
      const d = dailyMinutes({ ...empty, focus: [] }, at(2026, month, 28, 12), 40);
      for (const x of d) expect(new Date(x.day).getHours()).toBe(0);
    }
  });
});

describe("mastery and readiness", () => {
  it("prefers practice ability over placement levels", () => {
    const m = topicMastery(
      ["a", "b", "c"],
      [
        { topicId: "a", level: "weak" },
        { topicId: "b", level: "strong" },
      ],
      [{ topicKey: "a", topicTitle: "A", theta: 2, n: 8, updatedAt: 0 }],
    );
    expect(m[0].p).toBeGreaterThan(0.75);
    expect(m[0].evidence).toBe(8);
    expect(m[1].p).toBe(0.88);
    expect(m[2].p).toBeNull();
  });

  it("estimates a pass chance that grows with mastery and stays modest without data", () => {
    const strong = readiness(Array.from({ length: 6 }, (_, i) => ({ topicId: `t${i}`, p: 0.85, evidence: 12 })))!;
    const weak = readiness(Array.from({ length: 6 }, (_, i) => ({ topicId: `t${i}`, p: 0.4, evidence: 12 })))!;
    expect(strong.pass).toBeGreaterThan(0.9);
    expect(weak.pass).toBeLessThan(0.1);
    const half = readiness([
      { topicId: "a", p: 0.85, evidence: 3 },
      { topicId: "b", p: 0.85, evidence: 3 },
      { topicId: "c", p: null, evidence: 0 },
      { topicId: "d", p: null, evidence: 0 },
    ])!;
    expect(half.pass).toBeLessThan(strong.pass);
    expect(half.known).toBe(2);
    expect(readiness([{ topicId: "a", p: 0.9, evidence: 3 }, { topicId: "b", p: null, evidence: 0 }, { topicId: "c", p: null, evidence: 0 }, { topicId: "d", p: null, evidence: 0 }])).toBeNull();
  });

  it("layers topics by prerequisite depth and survives cycles", () => {
    const d = prereqDepth([
      { id: "a" },
      { id: "b", prereqs: ["a"] },
      { id: "c", prereqs: ["b", "missing"] },
      { id: "x", prereqs: ["y"] },
      { id: "y", prereqs: ["x"] },
    ]);
    expect([d.get("a"), d.get("b"), d.get("c")]).toEqual([0, 1, 2]);
    expect(d.has("x") && d.has("y")).toBe(true);
  });
});
