import { describe, expect, it } from "vitest";
import { difficultyFor, levelFor, levelFromTheta, pCorrect, targetDifficulty, updateTheta } from "./irt";
import { numbersMatch, parseNumber } from "./grade";
import { answersAgree, parseSolvedAnswer } from "./problems";

describe("irt", () => {
  it("targets about 70% success", () => {
    expect(pCorrect(1, targetDifficulty(1))).toBeCloseTo(0.7, 5);
  });
  it("moves ability up on success and down on failure, less for expected results", () => {
    const up = updateTheta(0, 0, true, 0);
    const down = updateTheta(0, 0, false, 0);
    expect(up).toBeGreaterThan(0);
    expect(down).toBeLessThan(0);
    // getting an easy item right barely moves it
    expect(updateTheta(0, -3, true, 0)).toBeLessThan(up);
    // steps shrink with experience
    expect(updateTheta(0, 0, true, 20) - 0).toBeLessThan(up);
    expect(updateTheta(3.9, -4, true, 0)).toBeLessThanOrEqual(4);
  });
  it("converges toward a learner's true ability", () => {
    let theta = 0;
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const truth = 1.5;
    for (let n = 0; n < 60; n++) {
      const b = targetDifficulty(theta);
      theta = updateTheta(theta, b, rand() < pCorrect(truth, b), n);
    }
    expect(Math.abs(theta - truth)).toBeLessThan(0.8);
  });
  it("maps difficulty to levels and back", () => {
    expect(levelFor(difficultyFor(4))).toBe(4);
    expect(levelFor(-10)).toBe(1);
    expect(levelFor(10)).toBe(5);
    expect(levelFromTheta(2, 1)).toBe("unknown");
    expect(levelFromTheta(-1, 5)).toBe("weak");
    expect(levelFromTheta(1.5, 5)).toBe("strong");
  });
});

describe("numeric answers", () => {
  it("parses common formats", () => {
    expect(parseNumber("1,234.5")).toBe(1234.5);
    expect(parseNumber("3/4")).toBe(0.75);
    expect(parseNumber("-2 1/2")).toBe(-2.5);
    expect(parseNumber("45%")).toBe(45);
    expect(parseNumber("12 cm")).toBe(12);
    expect(parseNumber("x = 4")).toBe(4);
    expect(parseNumber("$19.99")).toBe(19.99);
    expect(parseNumber("2,5")).toBe(2.5);
    expect(parseNumber("abc")).toBeNull();
    expect(parseNumber("1/0")).toBeNull();
  });
  it("matches with a small tolerance", () => {
    expect(numbersMatch(3.333, 10 / 3)).toBe(true);
    expect(numbersMatch(3.3, 10 / 3)).toBe(false);
    expect(numbersMatch(0, 0)).toBe(true);
  });
});

import { parseProblem } from "./problems";

describe("problem parsing", () => {
  it("accepts numeric, mcq (index or text answer) and short problems", () => {
    const n = parseProblem('{"kind":"numeric","question":"15% of 80?","answer":"12","solution":"$0.15\\\\cdot80=12$","level":2}', "t", 3);
    expect(n).toMatchObject({ kind: "numeric", answer: "12", difficulty: -1.2, options: null });
    const m = parseProblem('{"kind":"mcq","question":"Q?","options":["a","b","c","d"],"answer":"c","solution":"s"}', "t", 4);
    expect(m.answer).toBe("2");
    expect(m.difficulty).toBeCloseTo(1.2);
    const s = parseProblem('Sure! {"kind":"short","question":"Define ATP","answer":"energy carrier","solution":"ATP stores energy"}', "t", 3, "parent");
    expect(s.parentId).toBe("parent");
  });
  it("reads the hint, empty means none", () => {
    const h = parseProblem('{"kind":"numeric","question":"Q","answer":"1","solution":"s","hint":" Convert the percent first. "}', "t", 3);
    expect(h.hint).toBe("Convert the percent first.");
    expect(parseProblem('{"kind":"numeric","question":"Q","answer":"1","solution":"s"}', "t", 3).hint).toBeNull();
  });
  it("rejects unusable problems", () => {
    expect(() => parseProblem('{"kind":"numeric","question":"Q","answer":"twelve","solution":"s"}', "t", 3)).toThrow();
    expect(() => parseProblem('{"kind":"mcq","question":"Q","options":["a","b"],"answer":"z","solution":"s"}', "t", 3)).toThrow();
    expect(() => parseProblem("nothing", "t", 3)).toThrow();
  });
});

describe("answer check", () => {
  it("reads the last answer line, not LaTeX braces", () => {
    expect(parseSolvedAnswer('$\\frac{1}{2} \\cdot 10$ … {"answer": 5}')).toBe("5");
    expect(parseSolvedAnswer('{"answer": 3}\nwait, recheck\n{"answer": "2,5"}')).toBe("2,5");
    expect(parseSolvedAnswer("no json")).toBeNull();
  });
  it("compares numbers loosely and options by index or text", () => {
    expect(answersAgree({ kind: "numeric", answer: "125", options: null }, "125.0")).toBe(true);
    expect(answersAgree({ kind: "numeric", answer: "60", options: null }, "125")).toBe(false);
    const mcq = { kind: "mcq" as const, answer: "1", options: ["Layer 1", "Layer 2"] };
    expect(answersAgree(mcq, "1")).toBe(true);
    expect(answersAgree(mcq, "layer 2")).toBe(true);
    expect(answersAgree(mcq, "0")).toBe(false);
  });
});
