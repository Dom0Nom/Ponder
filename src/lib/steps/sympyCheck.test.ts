import { describe, expect, it } from "vitest";
import { mergeSympy, needsSymbolic, parseSympyOutput, sympyProgram } from "./sympyCheck";
import type { CalcCheck } from "./verify";

describe("sympy step path", () => {
  it("only asks for derivatives, matrices and symbolic simplification", () => {
    expect(needsSymbolic("d/dx (x^2 sin x)", ["2x sin x"])).toBe(true);
    expect(needsSymbolic("Simplify (x^2-1)/(x-1)", [])).toBe(true);
    expect(needsSymbolic(undefined, ["[[1,2],[3,4]]*[[0,1],[1,0]]"])).toBe(true);
    expect(needsSymbolic("Solve 2x + 3 = 11", ["2x = 8", "x = 4"])).toBe(false);
  });

  it("builds a program with the inputs as JSON strings", () => {
    const p = sympyProgram('Simplify "q"', ["x + x"]);
    expect(p).toContain('_run("Simplify \\"q\\"", ["x + x"])');
  });

  it("reads the last output line and rejects wrong lengths", () => {
    expect(parseSympyOutput("noise\n[true, false, null]", 3)).toEqual([true, false, null]);
    expect(parseSympyOutput("[true]", 2)).toBeNull();
    expect(parseSympyOutput("oops", 1)).toBeNull();
  });

  it("only fills steps the numeric check left undecided", () => {
    const right: CalcCheck = { status: "right", kind: "value" };
    const calc: CalcCheck[] = [{ status: "undecided" }, right, { status: "undecided" }, { status: "undecided" }];
    const out = mergeSympy(calc, [true, false, false, null]);
    expect(out[0]).toEqual({ status: "right", kind: "value" });
    expect(out[1]).toBe(right);
    expect(out[2].status).toBe("wrong");
    expect(out[3]).toEqual({ status: "undecided" });
    expect(mergeSympy(calc, null)).toBe(calc);
  });
});
