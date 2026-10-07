import { describe, expect, it } from "vitest";
import type { InlinePracticeMeta } from "../types";
import { advance, firstSentence, inlineTopic, isDone, rightCount, setResult, splitDisplayMath } from "./inline";

const meta = (over: Partial<InlinePracticeMeta> = {}): InlinePracticeMeta => ({
  answerId: "a",
  topicKey: "free:t",
  topicTitle: "t",
  items: [],
  index: 0,
  results: [],
  total: 3,
  ...over,
});

describe("inline practice state", () => {
  it("records a result without touching the original", () => {
    const m = meta();
    const next = setResult(m, 0, "right");
    expect(next.results).toEqual(["right"]);
    expect(m.results).toEqual([]);
  });

  it("advances up to total and reports done", () => {
    let m = meta({ index: 2 });
    expect(isDone(m)).toBe(false);
    m = advance(m);
    expect(isDone(m)).toBe(true);
    expect(advance(m).index).toBe(3);
  });

  it("counts right answers", () => {
    expect(rightCount(meta({ results: ["right", "wrong", "skipped", "right"] }))).toBe(2);
  });

  it("builds the free topic key from the thread title", () => {
    expect(inlineTopic("Systems of equations", "how do I choose").key).toBe("free:Systems of equations");
    expect(inlineTopic("  ", "how do I choose").title).toBe("how do I choose");
  });
});

describe("splitDisplayMath", () => {
  it("separates display math from prose", () => {
    expect(splitDisplayMath("Solve for $x$:\n$$y = 3x - 4$$\nthen check")).toEqual([
      { kind: "text", text: "Solve for $x$:" },
      { kind: "math", text: "$$y = 3x - 4$$" },
      { kind: "text", text: "then check" },
    ]);
  });
  it("returns the question unchanged without display math", () => {
    expect(splitDisplayMath("What is $2+2$?")).toEqual([{ kind: "text", text: "What is $2+2$?" }]);
  });
});

describe("firstSentence", () => {
  it("takes the first sentence", () => {
    expect(firstSentence("Substitute y into the second equation.\nThen solve for x.")).toBe("Substitute y into the second equation.");
  });
  it("falls back to the whole text", () => {
    expect(firstSentence("x = 3")).toBe("x = 3");
  });
});
