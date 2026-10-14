import { describe, expect, it } from "vitest";
import { layoutChart } from "../plot/charts";
import { answerText, gradeQuestion, pointsFor, responseText } from "./grade";
import { parseQuestion, parseQuestions, shuffleChoices } from "./parse";
import { questionKindsPrompt } from "./prompts";
import type { Question } from "./types";

const mc: Question = { kind: "mc", prompt: "2+2?", options: ["3", "4", "5", "6"], answer: 1 };
const multi: Question = { kind: "multi", prompt: "Primes?", options: ["2", "3", "4", "5"], answers: [0, 1, 3], points: 3 };
const fill: Question = { kind: "fill", prompt: "Half of 5?", accepted: ["2.5", "5/2"], numeric: true };
const dropdown: Question = { kind: "dropdown", prompt: "Pick", text: "It is {1} and {2}.", blanks: [{ options: ["a", "b"], answer: 0 }, { options: ["c", "d", "e"], answer: 2 }] };
const order: Question = { kind: "drag", prompt: "Order", mode: "order", items: ["x", "y", "z"], correctOrder: [2, 0, 1] };
const cat: Question = { kind: "drag", prompt: "Sort", mode: "categorize", items: ["a", "b", "c", "d"], categories: ["P", "Q"], correctCategory: [0, 1, 1, 0] };
const plane = { type: "plane" as const, xMin: -5, xMax: 5, yMin: -5, yMax: 5 };
const spot: Question = { kind: "hotspot", prompt: "Click (2,3)", stimulus: plane, region: { shape: "circle", x: 2, y: 3, r: 0.5 } };
const cell: Question = { kind: "hotspot", prompt: "Click", stimulus: { type: "table", columns: ["a", "b"], rows: [["1", "2"]] }, region: { shape: "cell", row: 0, col: 1 } };

describe("grading", () => {
  it("mc is all or nothing", () => {
    expect(gradeQuestion(mc, { kind: "mc", choice: 1 })).toEqual({ credit: 1, correct: true, answered: true });
    expect(gradeQuestion(mc, { kind: "mc", choice: 0 }).credit).toBe(0);
    expect(gradeQuestion(mc, null).answered).toBe(false);
    expect(gradeQuestion(mc, { kind: "fill", text: "4" }).credit).toBe(0);
  });

  it("multi gives partial credit and subtracts wrong picks", () => {
    expect(gradeQuestion(multi, { kind: "multi", choices: [0, 1, 3] }).correct).toBe(true);
    expect(gradeQuestion(multi, { kind: "multi", choices: [0, 1] }).credit).toBeCloseTo(2 / 3);
    expect(gradeQuestion(multi, { kind: "multi", choices: [0, 1, 2] }).credit).toBeCloseTo(1 / 3);
    expect(gradeQuestion(multi, { kind: "multi", choices: [2] }).credit).toBe(0);
    expect(pointsFor(multi, { kind: "multi", choices: [0, 1] })).toBe(2);
  });

  it("fill accepts numbers in any format", () => {
    for (const t of ["2.5", "5/2", " 2,5 ", "2.50"]) expect(gradeQuestion(fill, { kind: "fill", text: t }).correct).toBe(true);
    expect(gradeQuestion(fill, { kind: "fill", text: "3" }).correct).toBe(false);
    expect(gradeQuestion(fill, { kind: "fill", text: "" }).answered).toBe(false);
    const text: Question = { kind: "fill", prompt: "Capital?", accepted: ["Berlin"] };
    expect(gradeQuestion(text, { kind: "fill", text: " berlin. " }).correct).toBe(true);
  });

  it("dropdown scores the share of right blanks", () => {
    expect(gradeQuestion(dropdown, { kind: "dropdown", picks: [0, 2] }).correct).toBe(true);
    expect(gradeQuestion(dropdown, { kind: "dropdown", picks: [0, 1] }).credit).toBe(0.5);
    expect(gradeQuestion(dropdown, { kind: "dropdown", picks: [null, null] }).answered).toBe(false);
  });

  it("drag order and categorize give partial credit", () => {
    expect(gradeQuestion(order, { kind: "drag", order: [2, 0, 1] }).correct).toBe(true);
    expect(gradeQuestion(order, { kind: "drag", order: [2, 1, 0] }).credit).toBeCloseTo(1 / 3);
    expect(gradeQuestion(cat, { kind: "drag", placed: [0, 1, 1, 0] }).correct).toBe(true);
    expect(gradeQuestion(cat, { kind: "drag", placed: [0, 1, 0, -1] }).credit).toBe(0.5);
    expect(gradeQuestion(cat, { kind: "drag", placed: [-1, -1, -1, -1] }).answered).toBe(false);
  });

  it("hotspot checks the region", () => {
    expect(gradeQuestion(spot, { kind: "hotspot", x: 2.2, y: 3.1 }).correct).toBe(true);
    expect(gradeQuestion(spot, { kind: "hotspot", x: 4, y: 3 }).correct).toBe(false);
    expect(gradeQuestion(cell, { kind: "hotspot", row: 0, col: 1 }).correct).toBe(true);
    expect(gradeQuestion(cell, { kind: "hotspot", row: 0, col: 0 }).correct).toBe(false);
  });

  it("describes answers", () => {
    expect(answerText(multi)).toBe("2; 3; 5");
    expect(answerText(order)).toBe("z → x → y");
    expect(responseText(cat, { kind: "drag", placed: [0, 1, 1, -1] })).toBe("a → P; b → Q; c → Q; d → –");
  });
});

describe("parsing", () => {
  it("reads the old quiz shape as mc", () => {
    const q = parseQuestion({ question: "Q?", options: ["a", "b"], answer: 1, explanation: "e" });
    expect(q).toMatchObject({ kind: "mc", prompt: "Q?", answer: 1 });
  });

  it("validates each kind and drops broken ones", () => {
    const list = [
      { kind: "mc", prompt: "ok", options: ["a", "b"], answer: 0 },
      { kind: "mc", prompt: "bad index", options: ["a", "b"], answer: 5 },
      { kind: "mc", prompt: "dupe", options: ["a", "a"], answer: 0 },
      { kind: "multi", prompt: "ok", options: ["a", "b", "c"], answers: [0, 2] },
      { kind: "multi", prompt: "all correct", options: ["a", "b"], answers: [0, 1] },
      { kind: "fill", prompt: "ok", accepted: ["4"] },
      { kind: "fill", prompt: "no key", accepted: [] },
      { kind: "dropdown", prompt: "ok", text: "A {1} B", blanks: [{ options: ["x", "y"], answer: 1 }] },
      { kind: "dropdown", prompt: "missing marker", text: "A B", blanks: [{ options: ["x", "y"], answer: 1 }] },
      { kind: "drag", prompt: "ok", mode: "order", items: ["a", "b", "c"], correctOrder: [1, 0, 2] },
      { kind: "drag", prompt: "not a permutation", mode: "order", items: ["a", "b", "c"], correctOrder: [1, 1, 2] },
      { kind: "drag", prompt: "ok", mode: "categorize", items: ["a", "b"], categories: ["X", "Y"], correctCategory: [0, 1] },
      { kind: "hotspot", prompt: "ok", stimulus: { type: "plane", xMin: 0, xMax: 5, yMin: 0, yMax: 5 }, region: { shape: "circle", x: 1, y: 1, r: 0.5 } },
      { kind: "hotspot", prompt: "no stimulus", region: { shape: "circle", x: 1, y: 1, r: 0.5 } },
      { kind: "nope", prompt: "x" },
    ];
    const out = parseQuestions(JSON.stringify({ questions: list }));
    expect(out.map((q) => q.kind)).toEqual(["mc", "multi", "fill", "dropdown", "drag", "drag", "hotspot"]);
  });

  it("parses stimuli and drops unusable ones", () => {
    const q = parseQuestion({
      kind: "mc",
      prompt: "Which year is highest?",
      options: ["2020", "2021"],
      answer: 1,
      stimulus: { type: "chart", chart: { type: "bar", categories: ["2020", "2021"], series: [{ name: "Sales", values: [3, 5] }] } },
    });
    expect(q?.stimulus?.type).toBe("chart");
    const bad = parseQuestion({ kind: "mc", prompt: "x", options: ["a", "b"], answer: 0, stimulus: { type: "chart", chart: { type: "bar", categories: ["a", "b"], series: [{ name: "s", values: [1] }] } } });
    expect(bad?.stimulus).toBeUndefined();
  });

  it("shuffling keeps the key on the right option", () => {
    for (let i = 0; i < 20; i++) {
      const q = shuffleChoices(multi, Math.random);
      expect(q.kind === "multi" && q.answers.map((a) => q.options[a]).sort()).toEqual(["2", "3", "5"]);
    }
    const s = shuffleChoices(mc);
    expect(s.kind === "mc" && s.options[s.answer]).toBe("4");
  });

  it("prompt lists only the requested kinds", () => {
    const p = questionKindsPrompt(["mc", "fill"]);
    expect(p).toContain('"mc"');
    expect(p).toContain('"fill"');
    expect(p).not.toContain('"hotspot"');
    expect(questionKindsPrompt(["mc"], { stimulus: true })).toContain("stimulus");
  });
});

describe("charts", () => {
  it("lays out bars from zero with ticks", () => {
    const l = layoutChart({ type: "bar", categories: ["a", "b"], series: [{ name: "s", values: [10, 20] }] });
    expect(l.marks).toHaveLength(2);
    expect(l.marks[1].h!).toBeGreaterThan(l.marks[0].h!);
    expect(l.yTicks[0].v).toBe(0);
    expect(l.xTicks.map((t) => t.label)).toEqual(["a", "b"]);
  });

  it("lays out lines and scatter and maps pixels back", () => {
    const line = layoutChart({ type: "line", categories: ["a", "b", "c"], series: [{ name: "s", values: [1, 3, 2] }] });
    expect(line.lines[0].points).toHaveLength(3);
    const sc = layoutChart({ type: "scatter", series: [{ name: "s", points: [[0, 0], [10, 20]] }] });
    const [px, py] = sc.toPx(5, 10);
    const [x, y] = sc.fromPx(px, py);
    expect(x).toBeCloseTo(5);
    expect(y).toBeCloseTo(10);
  });
});
