import { describe, expect, it } from "vitest";
import { citedNumbers, hitsToCitations, splitSegments } from "./citations";

describe("citations", () => {
  it("finds cited numbers in first-use order and ignores unknown ones", () => {
    expect(citedNumbers("A [2]. B [1][2]. C [3, 1]. D [9]. E [x]", 3)).toEqual([2, 1, 3]);
  });

  it("maps hits to numbered citations with real offsets", () => {
    const c = hitsToCitations([
      { chunkId: 7, sourceId: "s", sourceTitle: "Bio", text: "x".repeat(400), start: 10, end: 410, page: 3, score: 1 },
    ]);
    expect(c[0]).toMatchObject({ n: 1, chunkId: 7, start: 10, end: 410, page: 3 });
    expect(c[0].snippet.length).toBeLessThanOrEqual(280);
  });

  it("splits explicit general-knowledge markers", () => {
    const segs = splitSegments("Chloroplasts hold chlorophyll [1].\n\n{{general}}Fun fact: leaves look green.{{/general}}", {
      hadSources: true,
      known: 1,
    });
    expect(segs).toEqual([
      { kind: "sourced", text: "Chloroplasts hold chlorophyll [1]." },
      { kind: "general", text: "Fun fact: leaves look green." },
    ]);
  });

  it("tags uncited prose paragraphs as general when sources were given", () => {
    const long = "This paragraph makes a long factual claim about the Calvin cycle without citing any passage at all.";
    const segs = splitSegments(`Short intro:\n\n${long}\n\nCited claim about light reactions in thylakoids [1].`, {
      hadSources: true,
      known: 1,
    });
    expect(segs.map((s) => s.kind)).toEqual(["sourced", "general", "sourced"]);
  });

  it("keeps code blocks intact and marks everything general without sources", () => {
    const text = "```py\nprint(1)\n\nprint(2)\n```";
    expect(splitSegments(text, { hadSources: true, known: 2 })).toEqual([{ kind: "sourced", text }]);
    expect(splitSegments("Anything.", { hadSources: false, known: 0 })[0].kind).toBe("general");
  });

  it("handles an unterminated marker while streaming", () => {
    const segs = splitSegments("Fact [1].\n\n{{general}}Still typing", { hadSources: true, known: 1 });
    expect(segs[1]).toEqual({ kind: "general", text: "Still typing" });
  });
});
