import { describe, expect, it } from "vitest";
import { finishReport, gapPrompt, parseGaps, reportPrompt } from "./reportPrompts";

const sources = [
  { title: "Mitosis", url: "https://a.org/mitosis", markdown: "Mitosis divides one nucleus into two." },
  { title: "Cell cycle", url: "https://b.org/cycle", markdown: "The cell cycle has four phases." },
];

describe("report citations", () => {
  it("keeps real citations, drops invented numbers, and appends the numbered list", () => {
    const r = finishReport("# Cells\n\nCells divide [1]. Phases matter [2][7]. Made up [0] and [9].\n\n## Not covered\n\nNothing important.", sources);
    expect(r.cited).toEqual([1, 2]);
    expect(r.markdown).toContain("Cells divide [1]. Phases matter [2]. Made up and.");
    expect(r.markdown).not.toMatch(/\[(0|7|9)\]/);
    expect(r.markdown.endsWith("## Sources\n\n- [1] Mitosis — https://a.org/mitosis\n- [2] Cell cycle — https://b.org/cycle\n")).toBe(true);
  });

  it("splits grouped citations like [1, 2] and drops out-of-range members", () => {
    const r = finishReport("A [1, 2] B [2; 5].", sources);
    expect(r.markdown.startsWith("A [1][2] B [2].")).toBe(true);
    expect(r.cited).toEqual([1, 2]);
  });

  it("replaces a source list the model wrote anyway and unwraps a code fence", () => {
    const r = finishReport("```markdown\n# T\n\nText [1].\n\n## Sources\n\n1. Something [3] made up\n```", sources);
    expect(r.markdown.match(/## Sources/g)).toHaveLength(1);
    expect(r.markdown).not.toContain("made up");
    expect(r.markdown).not.toContain("```");
    expect(r.cited).toEqual([1]);
  });

  it("reports no citations when the text has none", () => {
    expect(finishReport("# T\n\nNo numbers here.", sources).cited).toEqual([]);
  });

  it("numbers sources in the prompt in order and trims long texts", () => {
    const p = reportPrompt("What is mitosis?", [{ ...sources[0], markdown: "x".repeat(20000) }, sources[1]]);
    expect(p.startsWith("Write a short study report for a learner")).toBe(true);
    expect(p).toContain('<source n="1" title="Mitosis" url="https://a.org/mitosis">');
    expect(p).toContain('<source n="2" title="Cell cycle"');
    expect(p).not.toContain("x".repeat(5001));
    expect(p.trimEnd().endsWith("Return the Markdown report only.")).toBe(true);
  });
});

describe("gap prompt and parsing", () => {
  it("lists kept sources and searched queries", () => {
    const p = gapPrompt("How do cells divide?", [{ title: "Mitosis", summary: "Explains mitosis." }], ["cell division", "mitosis"]);
    expect(p).toContain("[1] Mitosis: Explains mitosis.");
    expect(p).toContain("- cell division");
    expect(p.trimEnd().split("\n").at(-1)).toMatch(/^Return JSON only:/);
  });

  it("caps at 3 queries, drops repeats of searched ones, and clears gaps when nothing is left to search", () => {
    expect(parseGaps({ gaps: ["a", "b", "c", "d"], queries: ["Mitosis", "new one", "new one", "two", "three", "four"] }, ["mitosis"])).toEqual({
      gaps: ["a", "b", "c"],
      queries: ["new one", "two", "three"],
    });
    expect(parseGaps({ gaps: ["x"], queries: ["mitosis"] }, ["Mitosis"])).toEqual({ gaps: [], queries: [] });
    expect(parseGaps(null)).toEqual({ gaps: [], queries: [] });
    expect(parseGaps({ gaps: "no", queries: [1, null] })).toEqual({ gaps: [], queries: [] });
  });
});
