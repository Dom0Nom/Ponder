import { describe, expect, it } from "vitest";
import { blankOutcome, blanksFor, countsTowardAbility, nextRung, sameStep, type Rung } from "./ladder";
import { parseLadderProblem } from "./problems";

describe("ladder moves", () => {
  it("moves up on a correct answer and stops at the cold rung", () => {
    expect(nextRung(0, true)).toBe(1);
    expect(nextRung(2, true)).toBe(3);
    expect(nextRung(3, true)).toBe(3);
  });

  it("steps down once on a miss and stops at the worked example", () => {
    expect(nextRung(3, false)).toBe(2);
    expect(nextRung(1, false)).toBe(0);
    expect(nextRung(0, false)).toBe(0);
  });
});

describe("blanks per rung", () => {
  it("blanks nothing on the worked rung and everything on the cold rung", () => {
    expect(blanksFor(0, 4)).toEqual([]);
    expect(blanksFor(3, 4)).toEqual([0, 1, 2, 3]);
  });

  it("blanks the last steps on rung 1 and keeps the first step", () => {
    expect(blanksFor(1, 3)).toEqual([2]);
    expect(blanksFor(1, 6)).toEqual([4, 5]);
    expect(blanksFor(1, 1)).toEqual([]);
  });

  it("blanks most steps on rung 2 and keeps the first", () => {
    expect(blanksFor(2, 4)).toEqual([1, 2, 3]);
    expect(blanksFor(2, 1)).toEqual([0]);
  });

  it("blanks more on each higher rung", () => {
    for (const n of [3, 4, 5, 8]) {
      expect(blanksFor(1, n).length).toBeLessThanOrEqual(blanksFor(2, n).length);
      expect(blanksFor(2, n).length).toBeLessThanOrEqual(blanksFor(3, n).length);
    }
  });
});

describe("blank checking", () => {
  it("ignores spacing, case and math delimiters", () => {
    expect(sameStep("$0.1 \\cdot 50 = 5$", "0.1*50 = 5")).toBe(true);
    expect(sameStep("x = 4", "x = 5")).toBe(false);
  });

  it("is right only when every blank is right", () => {
    expect(blankOutcome([true, true])).toBe(true);
    expect(blankOutcome([true, false])).toBe(false);
    expect(blankOutcome([])).toBe(false);
  });
});

describe("ladder problem parsing", () => {
  it("reads question, steps and answer", () => {
    const p = parseLadderProblem('{"question":"10% of 50?","steps":["0.1 x 50","5"],"answer":"5"}');
    expect(p).toEqual({ question: "10% of 50?", steps: ["0.1 x 50", "5"], answer: "5" });
  });

  it("rejects problems with fewer than two steps", () => {
    expect(() => parseLadderProblem('{"question":"q","steps":["a"],"answer":"1"}')).toThrow();
  });
});

describe("ability evidence", () => {
  it("counts only the cold rung", () => {
    expect([0, 1, 2, 3].map((r) => countsTowardAbility(r as Rung))).toEqual([false, false, false, true]);
  });
});
