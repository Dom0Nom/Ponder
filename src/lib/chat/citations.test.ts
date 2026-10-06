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

  it("flags uncited prose paragraphs when sources were given", () => {
    const long = "This paragraph makes a long factual claim about the Calvin cycle without citing any passage at all.";
    const segs = splitSegments(`Short intro:\n\n${long}\n\nCited claim about light reactions in thylakoids [1].`, {
      hadSources: true,
      known: 1,
    });
    expect(segs.map((s) => s.kind)).toEqual(["sourced", "uncited", "sourced"]);
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

import { inferCitations, overlap } from "./citations";

describe("citation inference", () => {
  const passages = [
    { n: 1, text: "Glycolysis happens in the cytoplasm and splits glucose into two pyruvate molecules." },
    { n: 2, text: "The Calvin cycle takes place in the stroma. It uses ATP and NADPH to fix carbon dioxide into glucose. RuBisCO catalyzes the first step." },
  ];

  it("attaches a matched citation to an uncited paragraph that paraphrases a passage", () => {
    const text =
      "Good question [2].\n\nThe Calvin cycle takes place in the stroma of the chloroplast and uses ATP and NADPH to fix carbon dioxide into glucose; RuBisCO catalyzes the first step.";
    const out = inferCitations(text, passages);
    expect(out.endsWith("[~2]")).toBe(true);
    expect(splitSegments(out, { hadSources: true, known: 2 }).every((s) => s.kind === "sourced")).toBe(true);
    expect(citedNumbers(out, 2)).toEqual([2]);
  });

  it("leaves unrelated paragraphs, general blocks and code alone", () => {
    const unrelated = "Volcanoes form where tectonic plates diverge or converge, letting magma rise toward the surface over time.";
    expect(inferCitations(unrelated, passages)).toBe(unrelated);
    const general = "{{general}}The Calvin cycle takes place in the stroma and uses ATP and NADPH to fix carbon dioxide into glucose.{{/general}}";
    expect(inferCitations(general, passages)).toBe(general);
    const code = "```\nThe Calvin cycle takes place in the stroma and uses ATP and NADPH to fix carbon dioxide.\n\nRuBisCO catalyzes the first step of fixing carbon dioxide into glucose in the stroma.\n```";
    expect(inferCitations(code, passages)).toBe(code);
  });

  it("scores overlap on content words, umlauts included", () => {
    expect(overlap("Grüne Blätter enthalten Chlorophyll und fangen Licht", "Chlorophyll in grüne Blätter fangen Licht")).toBeGreaterThan(0.6);
    expect(overlap("short text", "short text")).toBe(0);
  });
});
