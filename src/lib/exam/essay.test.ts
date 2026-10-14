import { describe, expect, it } from "vitest";
import { mergeGrades, needsThirdPass, type EssayGrade } from "./essay";

const g = (a: number, b: number, c: number, summary = "s"): EssayGrade => ({
  traits: [a, b, c].map((score, i) => ({ trait: (i + 1) as 1 | 2 | 3, score: score as 0 | 1 | 2, reason: `r${i + 1}-${score}` })),
  total: a + b + c,
  summary,
});

describe("essay two-pass merge", () => {
  it("needs no third pass when traits differ by at most one", () => {
    expect(needsThirdPass(g(2, 1, 1), g(1, 1, 2))).toBe(false);
  });

  it("asks for a third pass when a trait differs by two", () => {
    expect(needsThirdPass(g(2, 1, 1), g(0, 1, 1))).toBe(true);
  });

  it("keeps the lower score on a one-point difference", () => {
    const m = mergeGrades([g(2, 1, 1), g(1, 1, 2)]);
    expect(m.traits.map((t) => t.score)).toEqual([1, 1, 1]);
    expect(m.total).toBe(3);
  });

  it("takes the median per trait with three passes", () => {
    const m = mergeGrades([g(2, 1, 0), g(0, 1, 2), g(1, 1, 2)]);
    expect(m.traits.map((t) => t.score)).toEqual([1, 1, 2]);
    expect(m.total).toBe(4);
  });

  it("uses the reason from a pass that gave the final score", () => {
    const m = mergeGrades([g(2, 1, 0), g(0, 1, 2), g(1, 1, 2)]);
    expect(m.traits[0].reason).toBe("r1-1");
    expect(m.traits[2].reason).toBe("r3-2");
  });
});
