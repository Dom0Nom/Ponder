import { describe, expect, it } from "vitest";
import { answeredAt, creditAt, examResult } from "./attempt";
import { GED } from "./formats";
import { toQuiz } from "./generate";

const multi = { kind: "multi" as const, prompt: "Primes?", options: ["2", "3", "4", "5"], answers: [0, 1, 3], topicId: "a" };
const drag = { kind: "drag" as const, mode: "order" as const, prompt: "Order", items: ["x", "y", "z"], correctOrder: [2, 0, 1], topicId: "a" };

describe("rich exam questions", () => {
  it("keeps plain multiple choice in the old shape and wraps the rest", () => {
    expect(toQuiz({ kind: "mc", prompt: "q", options: ["a", "b"], answer: 1, topicId: "a" })).toEqual({ topicId: "a", question: "q", options: ["a", "b"], answer: 1, explanation: "" });
    expect(toQuiz(multi).rich).toEqual(multi);
    const withTable = toQuiz({ kind: "mc", prompt: "q", options: ["a", "b"], answer: 1, stimulus: { type: "table", columns: ["x", "y"], rows: [["1", "2"]] } });
    expect(withTable.rich?.kind).toBe("mc");
  });

  it("scores partial credit and counts answered questions", () => {
    const data = {
      questions: [toQuiz(multi), toQuiz(drag), { topicId: "a", question: "q", options: ["a", "b"], answer: 0, explanation: "" }],
      answers: [null, null, 0] as (number | null)[],
      responses: [{ kind: "multi" as const, choices: [0, 1] }, { kind: "drag" as const, order: [2, 0, 1] }, null],
      flags: [false, false, false],
      topics: [{ id: "a", title: "A" }],
    };
    expect([0, 1, 2].map((i) => answeredAt(data, i))).toEqual([true, true, true]);
    expect(creditAt(data, 0)).toBeCloseTo(2 / 3);
    const r = examResult(GED, data);
    expect(r.correct).toBe(2.75);
    expect(r.byTopic[0]).toMatchObject({ correct: 2.75, total: 3 });
    expect(answeredAt({ ...data, responses: [null, null, null], answers: [null, null, null] }, 0)).toBe(false);
  });
});
