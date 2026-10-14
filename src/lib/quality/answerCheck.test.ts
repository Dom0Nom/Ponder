import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it } from "vitest";
import type { ResolvedModel } from "../chat/llm";
import { GED } from "../exam/formats";
import { generateExamQuestions } from "../exam/generate";
import type { QuizQuestion, TopicRef } from "../types";
import { checkChoice, checkNumber, choiceVerdict, makeSolver, newStats, numberVerdict, parseChoices, parseSolvedAnswer, repairQuestions, type Solver } from "./answerCheck";

const q = (question: string, answer = 0): QuizQuestion => ({ topicId: "t1", question, options: ["Right", "A", "B", "C"], answer, explanation: "" });

const solverSaying = (reply: (prompt: string) => string): Solver & { calls: string[] } => {
  const calls: string[] = [];
  return {
    separate: false,
    calls,
    ask: async (p) => {
      calls.push(p);
      return reply(p);
    },
  };
};

const text = (opts: unknown) => {
  const m = (opts as { prompt: { role: string; content: unknown }[] }).prompt.filter((x) => x.role === "user").at(-1);
  return Array.isArray(m?.content) ? m.content.map((p: { text?: string }) => p.text ?? "").join("") : String(m?.content ?? "");
};

function fakeLlm(reply: (user: string) => string, modelId = "m") {
  const calls: string[] = [];
  const optionCalls: unknown[] = [];
  const model = new MockLanguageModelV4({
    doGenerate: async (opts: unknown) => {
      const user = text(opts);
      calls.push(user);
      return {
        content: [{ type: "text", text: reply(user) }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: { inputTokens: { total: 1, noCache: 1 }, outputTokens: { total: 1, text: 1 } },
        warnings: [],
      };
    },
  } as never);
  const llm = { model, modelId, options: (o: unknown) => (optionCalls.push(o), {}) } as unknown as ResolvedModel;
  return { llm, calls, optionCalls };
}

describe("solver output parsing", () => {
  it("reads the last correct-list as indexes", () => {
    expect(parseChoices('{"correct": ["A"]} wait {"correct": ["C"]}', 4)).toEqual([2]);
    expect(parseChoices('{"correct": ["b", "D"]}', 4)).toEqual([1, 3]);
    expect(parseChoices('{"correct": [1]}', 4)).toEqual([1]);
    expect(parseChoices('{"correct": []}', 4)).toEqual([]);
    expect(parseChoices('{"correct": ["F"]}', 4)).toEqual([]);
    expect(parseChoices("no json", 4)).toBeNull();
    expect(parseChoices('<think>{"correct": ["A"]}</think>', 4)).toBeNull();
  });

  it("reads the last numeric answer", () => {
    expect(parseSolvedAnswer('x {"answer": 3}\n{"answer": "2,5"}')).toBe("2,5");
    expect(parseSolvedAnswer("nothing")).toBeNull();
  });

  it("turns answers into verdicts", () => {
    expect(choiceVerdict([1], 1)).toBe("ok");
    expect(choiceVerdict([2], 1)).toBe("wrong");
    expect(choiceVerdict([1, 2], 1)).toBe("ambiguous");
    expect(choiceVerdict([], 1)).toBe("wrong");
    expect(choiceVerdict(null, 1)).toBe("unknown");
    expect(numberVerdict("12.0", "12")).toBe("ok");
    expect(numberVerdict("13", "12")).toBe("wrong");
    expect(numberVerdict(null, "12")).toBe("unknown");
  });
});

describe("checking single questions", () => {
  it("solver sees options but not the key", async () => {
    const solver = solverSaying(() => '{"correct": ["A"]}');
    expect(await checkChoice(solver, q("2+2?"), undefined)).toBe("ok");
    expect(solver.calls[0]).toContain("A: Right");
    expect(solver.calls[0]).not.toMatch(/answer.*0/i);
    expect(await checkNumber(solverSaying(() => '{"answer": 4}'), { question: "2+2?", answer: "4" })).toBe("ok");
  });

  it("keeps the question when the solver fails", async () => {
    const solver: Solver = { separate: false, ask: async () => Promise.reject(new Error("offline")) };
    expect(await checkChoice(solver, q("x"))).toBe("unknown");
  });

  it("rethrows aborts", async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const solver: Solver = { separate: false, ask: async () => Promise.reject(new Error("aborted")) };
    await expect(checkChoice(solver, q("x"), ctrl.signal)).rejects.toThrow();
  });
});

describe("repairQuestions", () => {
  const byQuestion = (verdicts: Record<string, string>) => solverSaying((p) => verdicts[Object.keys(verdicts).find((k) => p.includes(k))!] ?? '{"correct": ["A"]}');

  it("keeps everything when the solver agrees", async () => {
    const solver = byQuestion({});
    const regenerate = async () => [];
    const stats = newStats();
    const out = await repairQuestions([q("one"), q("two")], { solver, regenerate, stats });
    expect(out.map((x) => x.question)).toEqual(["one", "two"]);
    expect(stats).toEqual({ checked: 2, replaced: 0 });
  });

  it("drops disagreements and two-correct questions and regenerates them once, in one call", async () => {
    const solver = byQuestion({ wrongkey: '{"correct": ["B"]}', twocorrect: '{"correct": ["A", "C"]}' });
    let regenCalls = 0;
    let asked: string[] = [];
    const stats = newStats();
    const out = await repairQuestions([q("fine"), q("wrongkey"), q("twocorrect")], {
      solver,
      stats,
      regenerate: async (bad) => {
        regenCalls++;
        asked = bad.map((b) => b.question);
        return [q("fresh1"), q("fresh2")];
      },
    });
    expect(regenCalls).toBe(1);
    expect(asked).toEqual(["wrongkey", "twocorrect"]);
    expect(out.map((x) => x.question)).toEqual(["fine", "fresh1", "fresh2"]);
    expect(stats.replaced).toBe(2);
  });

  it("does not regenerate twice when the new questions also fail", async () => {
    const solver = byQuestion({ bad: '{"correct": ["B"]}' });
    let regenCalls = 0;
    const stats = newStats();
    const out = await repairQuestions([q("fine"), q("bad")], {
      solver,
      stats,
      regenerate: async () => {
        regenCalls++;
        return [q("bad again")];
      },
    });
    expect(regenCalls).toBe(1);
    expect(out.map((x) => x.question)).toEqual(["fine"]);
    expect(stats.replaced).toBe(0);
  });

  it("keeps the originals if regeneration throws", async () => {
    const solver = byQuestion({ bad: '{"correct": ["B"]}' });
    const out = await repairQuestions([q("fine"), q("bad")], {
      solver,
      regenerate: async () => {
        throw new Error("model down");
      },
    });
    expect(out.map((x) => x.question)).toEqual(["fine"]);
  });
});

describe("solver model choice", () => {
  it("uses the helper model when it differs", async () => {
    const writer = fakeLlm(() => "writer");
    const helper = fakeLlm(() => '{"correct": ["A"]}', "helper");
    const solver = makeSolver(writer.llm, helper.llm);
    expect(solver.separate).toBe(true);
    await solver.ask("p");
    expect(helper.calls).toHaveLength(1);
    expect(writer.calls).toHaveLength(0);
  });

  it("falls back to the same model at temperature 0", async () => {
    const writer = fakeLlm(() => "x");
    const solver = makeSolver(writer.llm, writer.llm);
    expect(solver.separate).toBe(false);
    await solver.ask("p");
    expect(writer.optionCalls).toEqual([{ thinking: false, temperature: 0 }]);
  });
});

describe("exam generation with the answer check", () => {
  const topic = { id: "t1", title: "Topic", description: "d", group: "Math" } as TopicRef;
  const section = { ...GED.sections[1], parts: undefined, kinds: undefined } as (typeof GED.sections)[number];
  const json = (names: string[]) =>
    JSON.stringify(names.map((n) => ({ topicId: "t1", question: n, options: ["Right", "Wrong A", "Wrong B", "Wrong C"], answer: 0, explanation: "." })));
  const letterOf = (prompt: string, want: string) => {
    const line = prompt.split("\n").find((l) => /^[A-D]: /.test(l) && l.slice(3) === want);
    return line![0];
  };

  function script() {
    let writes = 0;
    const fake = fakeLlm((p) => {
      if (p.startsWith("Write multiple-choice questions")) {
        writes++;
        const n = Number(p.match(/id "t1"[^\n]*: (\d+)/)?.[1]);
        return writes === 1 ? json(["good 1", "WRONGKEY 2", "TWOCORRECT 3"].slice(0, n)) : json(Array.from({ length: n }, (_, i) => `fresh ${writes}.${i + 1}`));
      }
      if (p.startsWith("Solve this problem carefully")) {
        if (p.includes("WRONGKEY")) return `{"correct": ["${letterOf(p, "Wrong A")}"]}`;
        if (p.includes("TWOCORRECT")) return `{"correct": ["${letterOf(p, "Right")}", "${letterOf(p, "Wrong B")}"]}`;
        return `{"correct": ["${letterOf(p, "Right")}"]}`;
      }
      return "";
    });
    return { ...fake, writes: () => writes };
  }

  it("replaces bad questions once and reports how many", async () => {
    const s = script();
    const stats = newStats();
    const phases: string[] = [];
    const out = await generateExamQuestions(s.llm, GED, section, [topic], 3, { solver: makeSolver(s.llm), stats, onPhase: (p) => phases.push(p) });
    expect(s.writes()).toBe(2);
    expect(out.map((x) => x.question).sort()).toEqual(["fresh 2.1", "fresh 2.2", "good 1"]);
    expect(stats.replaced).toBe(2);
    expect(phases).toContain("checking");
    expect(phases.at(-1)).toBe("writing");
  });

  it("makes no solver calls when the check is off", async () => {
    const s = script();
    const out = await generateExamQuestions(s.llm, GED, section, [topic], 3, { solver: null });
    expect(s.writes()).toBe(1);
    expect(out).toHaveLength(3);
    expect(s.calls.some((c) => c.startsWith("Solve this problem"))).toBe(false);
  });
});
