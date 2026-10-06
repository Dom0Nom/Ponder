import { describe, expect, it, vi } from "vitest";
import type { ResolvedModel } from "../chat/llm";
import { checkSteps, firstWrongOf, mergeVerdicts, parseModelVerdicts } from "./check";
import { parseTranscription } from "./vision";

vi.mock("ai", () => ({ generateText: vi.fn(async ({ prompt }: { prompt: string }) => ({ text: (globalThis as any).__reply(prompt) })) }));
const llm = { model: {}, options: () => ({}) } as unknown as ResolvedModel;
const reply = (fn: (prompt: string) => string) => ((globalThis as any).__reply = fn);

describe("parseModelVerdicts", () => {
  it("reads fenced JSON with think tags and loose fields", () => {
    const text = '<think>hmm</think>Sure!\n```json\n{"steps":[{"step":1,"ok":"yes"},{"step":2,"correct":false,"issue":"Sign error","fix":"-x+3"}],"finalCorrect":"false","summary":"Step 2 is off."}\n```';
    const m = parseModelVerdicts(text, 2)!;
    expect(m.verdicts.get(0)).toEqual({ ok: true, issue: undefined, hint: undefined, fix: undefined });
    expect(m.verdicts.get(1)).toMatchObject({ ok: false, issue: "Sign error", fix: "-x+3" });
    expect(m.finalCorrect).toBe(false);
    expect(m.summary).toBe("Step 2 is off.");
  });
  it("accepts a bare array, ignores out-of-range steps, rejects junk", () => {
    const m = parseModelVerdicts('[{"index":1,"ok":true},{"index":9,"ok":false},{"ok":false,"issue":"x"}]', 3)!;
    expect([...m.verdicts.keys()]).toEqual([0, 2]);
    expect(parseModelVerdicts("I think step 2 is wrong.", 3)).toBeNull();
    expect(parseModelVerdicts('{"steps":[{"step":1,"ok":"maybe"}]}', 3)).toBeNull();
  });
});

describe("firstWrong and merging", () => {
  it("finds the first wrong step; the calculation overrides the model", () => {
    const model = parseModelVerdicts('[{"step":1,"ok":false,"issue":"bad"},{"step":2,"ok":true},{"step":3,"ok":true}]', 3);
    const v = mergeVerdicts(3, model, [{ status: "right", kind: "solutions" }, { status: "wrong", kind: "solutions", solution: 6, var: "x", solvesBefore: true }, { status: "undecided" }]);
    expect(v.map((x) => [x.ok, x.checkedBy])).toEqual([
      [true, "calc"],
      [false, "calc"],
      [true, "model"],
    ]);
    expect(v[1].issue).toContain("x = 6");
    expect(firstWrongOf(v)).toBe(1);
    expect(firstWrongOf(mergeVerdicts(2, null, []))).toBeNull();
  });
});

describe("checkSteps", () => {
  it("flags the sign error even when the model misses it", async () => {
    reply(() => '{"steps":[{"step":1,"ok":true},{"step":2,"ok":true},{"step":3,"ok":true}],"finalCorrect":true,"summary":"All good."}');
    const r = await checkSteps(llm, { problem: "Solve 5-(x-3)=0", steps: ["5-x-3=0", "2-x=0", "x=2"] });
    expect(r.firstWrong).toBe(0);
    expect(r.verdicts[0]).toMatchObject({ ok: false, checkedBy: "calc" });
    expect(r.finalCorrect).toBe(false);
    expect(r.summary).toBe("Step 1 has a mistake.");
  });
  it("keeps the model's explanation when both agree, and passes calculator notes in the prompt", async () => {
    let seen = "";
    reply((p) => {
      seen = p;
      return '{"steps":[{"step":1,"ok":false,"issue":"The minus must flip both signs.","hint":"What is $-(-3)$?","fix":"5-x+3=0"}],"summary":"Sign slip in step 1."}';
    });
    const r = await checkSteps(llm, { problem: "5-(x-3)=0", steps: ["5-x-3=0", "x=2"] });
    expect(seen).toContain("Step 1 is NOT equivalent");
    expect(r.verdicts[0]).toMatchObject({ ok: false, issue: "The minus must flip both signs.", fix: "5-x+3=0" });
    expect(r.summary).toBe("Sign slip in step 1.");
  });
  it("falls back to the model for prose steps and throws on an unreadable reply", async () => {
    reply(() => "no json here");
    await expect(checkSteps(llm, { problem: "", steps: ["first I add the numbers"] })).rejects.toThrow(/couldn't be read/);
  });
});

describe("parseTranscription", () => {
  it("reads steps from JSON and drops empty lines", () => {
    expect(parseTranscription('```json\n{"problem":"2x=4","steps":["2x = 4"," ","x = 2"]}\n```')).toEqual({ problem: "2x=4", steps: ["2x = 4", "x = 2"] });
    expect(parseTranscription('["a=1","b=2"]')).toEqual({ problem: "", steps: ["a=1", "b=2"] });
    expect(parseTranscription('{"steps":[{"latex":"x=1"}]}')).toEqual({ problem: "", steps: ["x=1"] });
    expect(() => parseTranscription("nothing")).toThrow();
  });
});
