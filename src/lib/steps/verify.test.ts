import { describe, expect, it } from "vitest";
import { compareEquations, compareExpr, compileExpr, normalizeMath, parseProblem, parseStep, verifyFinal, verifySteps } from "./verify";

const expr = (t: string) => {
  const p = parseStep(t, "simplify");
  if (p?.kind !== "expr") throw new Error(`not an expression: ${t}`);
  return p.e;
};
const eq = (t: string) => {
  const p = parseStep(t, "solve");
  if (p?.kind !== "eq") throw new Error(`not an equation: ${t}`);
  return p.f;
};

describe("normalizeMath", () => {
  it("handles LaTeX and unicode operators", () => {
    expect(normalizeMath("$2 \\cdot 3 \\times x \\div 4$")).toBe("2 * 3 * x / 4");
    expect(normalizeMath("\\frac{x+1}{2} − x²")).toBe("((x+1)/(2)) - x^2");
    expect(normalizeMath("\\sqrt{x} + \\sqrt[3]{8}")).toBe("sqrt(x) + nthRoot((8),(3))");
    expect(normalizeMath("\\left(x+1\\right)^{2}")).toBe("(x+1)^(2)");
    expect(normalizeMath("2x + 4 = 10 | -4")).toBe("2x + 4 = 10");
    expect(normalizeMath("\\Rightarrow x = 3")).toBe("x = 3");
    expect(normalizeMath("6 : 2")).toBe("6 / 2");
  });
});

describe("compareExpr", () => {
  it("accepts equivalent rewrites", () => {
    expect(compareExpr(expr("2(x-3)+4"), expr("2x-2")).status).toBe("right");
    expect(compareExpr(expr("(x+1)(x-1)"), expr("x^2-1")).status).toBe("right");
    expect(compareExpr(expr("x(x+1)"), expr("x^2+x")).status).toBe("right");
    expect(compareExpr(expr("\\frac{6x}{3}"), expr("2 \\cdot x")).status).toBe("right");
    expect(compareExpr(expr("2xy + y"), expr("y(2x+1)")).status).toBe("right");
  });
  it("rejects non-equivalent rewrites", () => {
    expect(compareExpr(expr("(x+1)^2"), expr("x^2+1")).status).toBe("wrong");
    expect(compareExpr(expr("6 ÷ 2 × x"), expr("x")).status).toBe("wrong");
  });
  it("catches the classic sign error -(x-3) = -x-3", () => {
    const r = compareExpr(expr("-(x-3)"), expr("-x-3"));
    expect(r.status).toBe("wrong");
    expect(compareExpr(expr("-(x-3)"), expr("-x+3")).status).toBe("right");
    expect(verifySteps("Simplify -(x-3)", ["-(x-3) = -x-3"])[0].status).toBe("wrong");
  });
  it("leaves prose and unparsable input undecided", () => {
    expect(parseStep("divide both sides by 2")).toBeNull();
    expect(parseStep("x > 3")).toBeNull();
    expect(compileExpr("2x +* 3")).toBeNull();
    expect(verifySteps("2x=4", ["now divide by two", "x = 2"]).map((c) => c.status)).toEqual(["undecided", "undecided"]);
  });
});

describe("compareEquations", () => {
  it("accepts equivalent equation steps", () => {
    expect(compareEquations(eq("2(x-3)+4=10"), eq("2x-6+4=10")).status).toBe("right");
    expect(compareEquations(eq("2x = 12"), eq("x = 6")).status).toBe("right");
    expect(compareEquations(eq("x^2 = 4"), eq("x = 2 or x = -2")).status).toBe("right");
    expect(compareEquations(eq("x^2 = 9"), eq("x = \\pm 3")).status).toBe("right");
    expect(compareEquations(eq("(x-3)^2 = 0"), eq("x = 3")).status).toBe("right");
  });
  it("rejects steps that change the solutions", () => {
    const r = compareEquations(eq("2x-2=10"), eq("2x=8"));
    expect(r).toMatchObject({ status: "wrong", kind: "solutions", solution: 6, solvesBefore: true });
    expect(compareEquations(eq("x^2 = 4"), eq("x = 2"))).toMatchObject({ status: "wrong", solution: -2 });
  });
});

describe("verifySteps", () => {
  it("flags the exact wrong step and follows the learner's line after it", () => {
    const steps = ["-2x-6+4=10", "-2x-2=10", "-2x=12", "x=-6"];
    expect(verifySteps("Solve -2(x-3)+4=10", steps).map((c) => c.status)).toEqual(["wrong", "right", "right", "right"]);
    expect(verifyFinal("Solve -2(x-3)+4=10", steps)).toBe(false);
  });
  it("accepts a correct solution and side calculations", () => {
    const steps = ["2(x-3) = 2x-6", "2x-6+4=10", "2x-2=10", "2x=12", "x=6"];
    expect(verifySteps("Solve for x: 2(x-3)+4=10", steps).every((c) => c.status === "right")).toBe(true);
    expect(verifyFinal("Solve for x: 2(x-3)+4=10", steps)).toBe(true);
    expect(verifyFinal(undefined, ["x = 6"], "6")).toBe(true);
    expect(verifyFinal(undefined, ["x = 5"], "x = 6")).toBe(false);
  });
  it("parses problem statements with words around the math", () => {
    expect(parseProblem("Solve 2(x-3)+4=10.")?.kind).toBe("eq");
    expect(parseProblem("Löse: 3x = 9")?.kind).toBe("eq");
    expect(parseProblem("Simplify -(x-3)+2x")?.kind).toBe("expr");
  });
});
