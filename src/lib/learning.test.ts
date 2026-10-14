import { describe, expect, it } from "vitest";
import { mixWeight, pickTopic } from "./practice/mix";
import { calibration, overconfidentTopics } from "./insights/calibration";
import { confidenceDue, confidenceRating } from "./srs/confidence";
import { nextSession, totalMinutes, focusGoal, type NextInput } from "./session/engine";
import { applyRetest, markLearned, masteryMap, retestPassed, statusOf, RETEST_AFTER_MS } from "./insights/mastery";
import { examPatterns, groupPatterns, type Wrong } from "./insights/patterns";
import { scoreBand, tierFor } from "./exam/band";
import { GED, SAT } from "./exam/formats";

const DAY = 86_400_000;

describe("mixer", () => {
  const cands = [
    { key: "a", weight: 1 },
    { key: "b", weight: 1 },
    { key: "c", weight: 5 },
  ];
  it("never repeats the last topic when others exist", () => {
    let last: string | null = null;
    let seed = 1;
    const rng = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 200; i++) {
      const k: string = pickTopic(cands, last, rng)!;
      expect(k).not.toBe(last);
      last = k;
    }
  });
  it("repeats when only one topic exists", () => {
    expect(pickTopic([{ key: "a", weight: 1 }], "a")).toBe("a");
    expect(pickTopic([], null)).toBeNull();
  });
  it("weights weak and due topics higher", () => {
    expect(mixWeight({ theta: -2, n: 5 }, false)).toBeGreaterThan(mixWeight({ theta: 2, n: 5 }, false));
    expect(mixWeight({ theta: 0, n: 5 }, true)).toBeGreaterThan(mixWeight({ theta: 0, n: 5 }, false));
  });
});

describe("calibration", () => {
  const row = (topicKey: string, correct: boolean, confidence: 0 | 1 | 2 | null) => ({ topicKey, correct, confidence });
  it("measures how often Sure was right and ignores unrated answers", () => {
    const c = calibration([row("t", true, 2), row("t", false, 2), row("t", false, 2), row("t", true, 2), row("t", true, null), row("t", true, 0)]);
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ answered: 5, sureN: 4, sureRight: 2, sureAccuracy: 0.5, overconfident: true });
  });
  it("needs enough Sure answers to call a topic overconfident", () => {
    expect(overconfidentTopics([row("t", false, 2), row("t", false, 2)])).toEqual([]);
    expect(overconfidentTopics([row("t", true, 2), row("t", true, 2), row("t", true, 2)])).toEqual([]);
  });
});

describe("confidence and FSRS", () => {
  it("caps a lucky guess at Hard", () => {
    expect(confidenceRating(3, 0)).toBe(2);
    expect(confidenceRating(4, 0)).toBe(2);
    expect(confidenceRating(3, 2)).toBe(3);
    expect(confidenceRating(1, 0)).toBe(1);
  });
  it("brings a wrong Sure back within a minute", () => {
    expect(confidenceDue(10 * DAY, 1, 2, 1000)).toBe(61_000);
    expect(confidenceDue(10 * DAY, 1, 1, 1000)).toBe(10 * DAY);
    expect(confidenceDue(10 * DAY, 3, 2, 1000)).toBe(10 * DAY);
  });
});

const base: NextInput = {
  goal: "Pass the GED",
  minutes: 25,
  lowEnergy: false,
  dueCards: 0,
  retests: [],
  prereqChecks: [],
  frontier: { key: "f", title: "Fractions" },
  planToday: [],
  hasTopics: true,
};

describe("next session", () => {
  it("puts due cards and retests first", () => {
    const b = nextSession({ ...base, dueCards: 12, retests: [{ key: "r", title: "Ratios" }] });
    expect(b.map((x) => x.kind)).toEqual(["review", "retest", "new", "practice", "reflect"]);
  });
  it("drops new material on low energy and shortens practice", () => {
    const b = nextSession({ ...base, lowEnergy: true, dueCards: 5 });
    expect(b.map((x) => x.kind)).toEqual(["review", "practice", "reflect"]);
    expect(b.find((x) => x.kind === "practice")!.minutes).toBeLessThanOrEqual(5);
  });
  it("works without a goal", () => {
    const b = nextSession({ ...base, goal: null });
    expect(b.length).toBeGreaterThan(0);
    expect(focusGoal({ goal: null, planToday: [] }, b)).toBe("Fractions");
    expect(focusGoal({ goal: "  ", planToday: ["Read ch 2"] }, b)).toBe("Read ch 2");
  });
  it("starts with new material when nothing is due", () => {
    const b = nextSession(base);
    expect(b[0].kind).toBe("new");
  });
  it("still returns practice and reflection with nothing else", () => {
    const b = nextSession({ ...base, frontier: null });
    expect(b.map((x) => x.kind)).toEqual(["practice", "reflect"]);
  });
  it("uses today's plan task for new material", () => {
    const b = nextSession({ ...base, planToday: ["Chapter 3"] });
    expect(b.find((x) => x.kind === "new")!.label).toBe("Chapter 3");
  });
  it("stays within the time available", () => {
    const b = nextSession({ ...base, minutes: 12, dueCards: 40, retests: [{ key: "r", title: "R" }, { key: "q", title: "Q" }] });
    expect(b.some((x) => x.kind === "new")).toBe(false);
    expect(totalMinutes(b)).toBeLessThanOrEqual(24);
  });
  it("adds one prerequisite check", () => {
    const b = nextSession({ ...base, prereqChecks: [{ key: "p", title: "Division" }, { key: "p2", title: "X" }] });
    expect(b.filter((x) => x.kind === "check")).toHaveLength(1);
  });
});

describe("mastery", () => {
  const T0 = 1_000_000;
  it("learned starts a 3-day wait, then the retest comes due", () => {
    const row = markLearned(null, "t", T0);
    expect(row).toMatchObject({ state: "retest", retestDueAt: T0 + RETEST_AFTER_MS });
    expect(statusOf(row, T0 + DAY)).toBe("waiting");
    expect(statusOf(row, T0 + 3 * DAY)).toBe("retest");
  });
  it("ignores a retest before it is due", () => {
    const row = markLearned(null, "t", T0);
    expect(applyRetest(row, true, T0 + DAY)).toBe(row);
  });
  it("passing a due retest masters the topic", () => {
    const row = applyRetest(markLearned(null, "t", T0), true, T0 + 3 * DAY);
    expect(row).toMatchObject({ state: "mastered", passedAt: T0 + 3 * DAY });
    expect(markLearned(row, "t", T0 + 9 * DAY)).toBe(row);
  });
  it("failing sends it back to learning, then the clock restarts", () => {
    const failed = applyRetest(markLearned(null, "t", T0), false, T0 + 4 * DAY);
    expect(statusOf(failed, T0 + 4 * DAY)).toBe("learning");
    const again = markLearned(failed, "t", T0 + 6 * DAY);
    expect(again.retestDueAt).toBe(T0 + 9 * DAY);
  });
  it("retest needs 2 of 3", () => {
    expect(retestPassed(2, 3)).toBe(true);
    expect(retestPassed(1, 3)).toBe(false);
    expect(retestPassed(2, 2)).toBe(false);
  });
  it("locked topics list what they wait for", () => {
    const topics = [
      { id: "a", title: "A", description: "", group: "g" },
      { id: "b", title: "B", description: "", group: "g", prereqs: ["a"] },
    ];
    const map = masteryMap(topics, [], new Set(), T0);
    expect(map[1].waitsFor).toEqual(["A"]);
    const mastered = [{ topicKey: "a", state: "mastered" as const, learnedAt: 0, retestDueAt: null, passedAt: 1 }];
    expect(masteryMap(topics, mastered, new Set(), T0)[1].waitsFor).toEqual([]);
    expect(masteryMap(topics, [], new Set(["b"]), T0)[1].waitsFor).toEqual([]);
  });
});

describe("patterns", () => {
  const w = (id: string, errorType: Wrong["errorType"], topic = "T"): Wrong => ({ id, question: id, given: "x", correct: "y", topic, errorType });
  it("groups error types into patterns, largest first, skipping untagged", () => {
    const p = groupPatterns([w("1", "sign"), w("2", "units"), w("3", "arithmetic"), w("4", "concept"), w("5", null), w("6", "misread")]);
    expect(p.map((x) => [x.id, x.count])).toEqual([
      ["slip", 3],
      ["concept", 1],
      ["misread", 1],
    ]);
  });
  it("limits examples", () => {
    const p = groupPatterns([1, 2, 3, 4, 5].map((i) => w(String(i), "sign")), 2);
    expect(p[0].examples).toHaveLength(2);
    expect(p[0].count).toBe(5);
  });
  it("exam patterns: unanswered is time, weak topic is concept, rest are traps", () => {
    const item = (id: string, given: number | null, topicWeak: boolean) => ({ id, question: id, options: ["a", "b"], answer: 0, given, topic: "T", topicWeak });
    const p = examPatterns([item("1", null, false), item("2", 1, true), item("3", 1, false), item("4", 0, false)]);
    expect(p.map((x) => x.id).sort()).toEqual(["concept", "time", "trap"]);
  });
});

describe("score band", () => {
  it("is wider with fewer questions", () => {
    const short = scoreBand(GED, 0.7, 10)!;
    const long = scoreBand(GED, 0.7, 46)!;
    expect(short.high - short.low).toBeGreaterThan(long.high - long.low);
  });
  it("narrows over attempts", () => {
    const one = scoreBand(GED, 0.7, 46, 1)!;
    const four = scoreBand(GED, 0.7, 46, 4)!;
    expect(four.high - four.low).toBeLessThan(one.high - one.low);
  });
  it("stays on the scale and contains the estimate", () => {
    const b = scoreBand(GED, 1, 10)!;
    expect(b.high).toBeLessThanOrEqual(200);
    expect(scoreBand(GED, 0, 10)!.low).toBeGreaterThanOrEqual(100);
  });
  it("looks up GED tiers", () => {
    expect(tierFor(GED, 144)).toBeNull();
    expect(tierFor(GED, 145)!.id).toBe("pass");
    expect(tierFor(GED, 164)!.id).toBe("pass");
    expect(tierFor(GED, 165)!.id).toBe("collegeReady");
    expect(tierFor(GED, 175)!.id).toBe("collegeReadyCredit");
  });
  it("has no band without a scale", () => {
    expect(scoreBand({ ...SAT, scale: undefined }, 0.7, 20)).toBeNull();
  });
});
