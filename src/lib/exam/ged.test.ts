import { describe, expect, it } from "vitest";
import { partClock } from "./attempt";
import { GED, hasCalculator, partRanges, resolveParts, type ExamSection } from "./formats";
import { FORMULA_SHEETS, practiceSheetFor } from "./formulas";
import { examQuestionPrompt } from "./generate";

const sec = (id: string) => GED.sections.find((x) => x.id === id) as ExamSection;
const MIN = 60_000;

describe("GED parts", () => {
  it("splits math into 5 no-calculator questions and the rest", () => {
    expect(partRanges(sec("math").parts, true, 46)).toEqual([
      { from: 0, to: 5, calculator: false },
      { from: 5, to: 46, calculator: true },
    ]);
    expect(partRanges(sec("math").parts, true, 12)).toEqual([
      { from: 0, to: 5, calculator: false },
      { from: 5, to: 12, calculator: true },
    ]);
  });

  it("shares the minutes by question count and keeps the total", () => {
    const full = resolveParts(sec("math"), "full");
    expect(full.map((p) => p.minutes)).toEqual([13, 102]);
    const short = resolveParts(sec("math"), "short");
    expect(short.map((p) => p.minutes)).toEqual([13, 17]);
    for (const l of ["short", "full"] as const) expect(resolveParts(sec("math"), l).reduce((n, p) => n + p.minutes, 0)).toBe(sec("math").minutes[l]);
  });

  it("sections without parts are one part", () => {
    expect(resolveParts(sec("rla"), "short")).toEqual([{ from: 0, to: 10, calculator: false, minutes: 50 }]);
    expect(hasCalculator(sec("rla"))).toBe(false);
  });

  it("only math has a calculator lock; social studies and science allow it", () => {
    expect(sec("math").parts?.[0].calculator).toBe(false);
    expect(hasCalculator(sec("math"))).toBe(true);
    expect(hasCalculator(sec("social"))).toBe(true);
    expect(sec("social").parts).toBeUndefined();
    expect(hasCalculator(sec("science"))).toBe(true);
  });

  it("part 1 counts down its own share, then the rest of the section", () => {
    const m = sec("math");
    const a = partClock(m, "full", undefined, 5 * MIN);
    expect(a).toMatchObject({ index: 0, count: 2, remainingMs: 8 * MIN, expired: false });
    expect(partClock(m, "full", undefined, 13 * MIN).expired).toBe(true);
    expect(partClock(m, "full", undefined, 20 * MIN).remainingMs).toBe(0);
    // started part 2 after 10 minutes: unused part 1 time carries over
    const b = partClock(m, "full", [10 * MIN], 12 * MIN);
    expect(b).toMatchObject({ index: 1, remainingMs: 103 * MIN, expired: false });
    expect(partClock(m, "full", [10 * MIN], 115 * MIN).remainingMs).toBe(0);
  });

  it("single-part sections keep the section clock", () => {
    expect(partClock(sec("rla"), "short", undefined, 10 * MIN)).toMatchObject({ index: 0, count: 1, remainingMs: 40 * MIN, expired: false });
  });

  it("writes the no-calculator prompt for part 1 only", () => {
    const t = { id: "t", title: "T", description: "d", group: "Math" };
    const m = sec("math");
    expect(examQuestionPrompt(GED, { ...m, calculator: false }, [{ topic: t, n: 5 }])).toContain("No calculator is allowed");
    expect(examQuestionPrompt(GED, m, [{ topic: t, n: 5 }])).toContain("scientific calculator is allowed");
  });
});

describe("formula sheet", () => {
  it("exists for math and science exams, not for RLA or social studies", () => {
    expect(sec("math").formulaSheet).toBe("math");
    expect(sec("science").formulaSheet).toBe("science");
    expect(sec("rla").formulaSheet).toBeUndefined();
    expect(sec("social").formulaSheet).toBeUndefined();
  });

  it("math sheet has every formula group", () => {
    const ids = FORMULA_SHEETS.math.flatMap((g) => g.items.map((i) => `${g.id}.${i.id}`));
    for (const id of [
      "area.rectangle",
      "perimeter.rectangle",
      "volume.cylinder",
      "surface.prism",
      "algebra.slope",
      "algebra.slopeIntercept",
      "algebra.pointSlope",
      "algebra.quadratic",
      "algebra.pythagorean",
      "algebra.interest",
      "algebra.distance",
      "algebra.cost",
    ])
      expect(ids).toContain(id);
  });

  it("science sheet has mean, median, mode and range", () => {
    expect(FORMULA_SHEETS.science.flatMap((g) => g.items.map((i) => i.id))).toEqual(["mean", "median", "mode", "range"]);
  });

  it("math practice topics get the sheet", () => {
    expect(practiceSheetFor("ged.math.geometry")).toBe("math");
    expect(practiceSheetFor("ged.rla.reading")).toBeNull();
    expect(practiceSheetFor("free:Percentages")).toBeNull();
  });
});
