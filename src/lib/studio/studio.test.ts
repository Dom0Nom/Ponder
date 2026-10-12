import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { studioReply } from "../../test/studioFixtures";
import { columnName, mindmapMarkdown, toCsv, toXlsx, worksheetMarkdown } from "./export";
import { buildMaterial } from "./generate";
import { cleanMermaid, OUTPUT_KINDS, parseOutput } from "./kinds";
import { layoutMindmap, wrapText } from "./mindmapLayout";
import { outputPrompt, outputPromptStart } from "./prompts";

const material = { sources: ["Biology ch. 8"], passages: [{ source: 1, text: "Photosynthesis happens in chloroplasts." }], summaries: [] };

describe("studio prompts", () => {
  it("opens every kind with a distinct, stable first line the mock matches", () => {
    const starts = OUTPUT_KINDS.map(outputPromptStart);
    expect(new Set(starts).size).toBe(OUTPUT_KINDS.length);
    for (const k of OUTPUT_KINDS) {
      const p = outputPrompt(k, material, "light reactions");
      expect(p.startsWith(outputPromptStart(k))).toBe(true);
      expect(p).toContain("[1] Biology ch. 8");
      expect(p).toContain("Focus on: light reactions.");
      expect(p.trim().split("\n").at(-1)!.startsWith("{")).toBe(true);
      expect(studioReply(p)).not.toBeNull();
    }
  });

  it("the canned replies parse for every kind", () => {
    for (const k of OUTPUT_KINDS) expect(parseOutput(k, studioReply(outputPrompt(k, material))!), k).not.toBeNull();
  });
});

describe("studio parsers", () => {
  it("drops worksheet questions whose answer isn't one of the options", () => {
    const reply = JSON.stringify({
      title: "T",
      questions: [
        { q: "a?", kind: "short", answer: "x" },
        { q: "b?", kind: "choice", options: ["1", "2"], answer: "3" },
        { q: "c?", kind: "fill", answer: "y" },
        { q: "d?", kind: "weird", answer: "z" },
      ],
    });
    const w = parseOutput("worksheet", reply)!;
    expect(w.data.questions.map((q) => [q.q, q.kind])).toEqual([["a?", "short"], ["c?", "fill"], ["d?", "short"]]);
    expect(parseOutput("worksheet", JSON.stringify({ title: "T", questions: [{ q: "a", answer: "b" }] }))).toBeNull();
  });

  it("pads short table rows and rejects tables without data", () => {
    const t = parseOutput("table", '{"title":"T","columns":["A","B","C"],"rows":[["1","2"],["3",4,"5","extra"]]}')!;
    expect(t.data.rows).toEqual([["1", "2", ""], ["3", "4", "5"]]);
    expect(parseOutput("table", '{"title":"T","columns":["A"],"rows":[["1"],["2"]]}')).toBeNull();
  });

  it("caps mind map depth and needs a real tree", () => {
    const deep = { label: "a", children: [{ label: "b", children: [{ label: "c", children: [{ label: "d", children: [{ label: "e", children: [] }] }] }] }] };
    const m = parseOutput("mindmap", JSON.stringify({ title: "T", root: { label: "R", children: [deep, { label: "x", children: [{ label: "y", children: [] }] }] } }))!;
    expect(m.data.root.children[0].children[0].children).toEqual([{ label: "c", children: [] }]);
    expect(parseOutput("mindmap", '{"title":"T","root":{"label":"R","children":[{"label":"a","children":[]}]}}')).toBeNull();
  });

  it("accepts Mermaid code with or without a fence and rejects other text", () => {
    expect(cleanMermaid("```mermaid\nflowchart TD\n A-->B\n```")).toBe("flowchart TD\n A-->B");
    expect(cleanMermaid("graph LR; A-->B")).toBe("graph LR; A-->B");
    expect(cleanMermaid("Here is your diagram: flowchart TD")).toBeNull();
  });

  it("needs a title", () => {
    expect(parseOutput("cheatsheet", JSON.stringify({ markdown: "word ".repeat(60) }))).toBeNull();
  });
});

describe("studio material", () => {
  it("numbers sources in the order passages use them, then sources that only have summaries", () => {
    const hit = (sourceId: string, title: string) => ({ chunkId: 1, sourceId, sourceTitle: title, text: ` ${title} text `, start: 0, end: 1, page: null, score: 1 });
    const m = buildMaterial(
      [
        { id: "a", title: "A", summary: null },
        { id: "b", title: "B", summary: "About B" },
        { id: "c", title: "C", summary: "About C" },
      ],
      [hit("b", "B"), hit("a", "A"), hit("b", "B")],
    );
    expect(m.sources).toEqual(["B", "A", "C"]);
    expect(m.passages.map((p) => p.source)).toEqual([1, 2, 1]);
    expect(m.passages[0].text).toBe("B text");
    expect(m.summaries).toEqual([{ source: 1, summary: "About B" }, { source: 3, summary: "About C" }]);
  });
});

describe("studio export", () => {
  it("quotes CSV cells that need it", () => {
    expect(toCsv(["a", "b"], [["x,y", 'say "hi"'], ["line\nbreak", "ok"]])).toBe('a,b\r\n"x,y","say ""hi"""\r\n"line\nbreak",ok\r\n');
  });

  it("names spreadsheet columns past Z", () => {
    expect([0, 25, 26, 27, 701, 702].map(columnName)).toEqual(["A", "Z", "AA", "AB", "ZZ", "AAA"]);
  });

  it("writes an xlsx with a bold header, escaped text and numeric cells", async () => {
    const bytes = await toXlsx({ caption: "", columns: ["Name", "Year"], rows: [["Tom & <Jerry>", "1940"], ["Ö", "-2.5"]] }, "Cartoons/2024");
    const zip = await JSZip.loadAsync(bytes);
    const sheet = await zip.file("xl/worksheets/sheet1.xml")!.async("string");
    expect(sheet).toContain('<c r="A1" t="inlineStr" s="1"><is><t xml:space="preserve">Name</t></is></c>');
    expect(sheet).toContain("Tom &amp; &lt;Jerry&gt;");
    expect(sheet).toContain('<c r="B2"><v>1940</v></c>');
    expect(sheet).toContain('<c r="B3"><v>-2.5</v></c>');
    expect(await zip.file("xl/workbook.xml")!.async("string")).toContain('name="Cartoons 2024"');
    expect(zip.file("[Content_Types].xml")).not.toBeNull();
  });

  it("puts the answer key after the questions", () => {
    const md = worksheetMarkdown("W", { instructions: "Go.", questions: [{ q: "Pick", kind: "choice", options: ["x", "y"], answer: "y" }] }, true);
    expect(md).toBe("# W\n\nGo.\n\n1. Pick\n   a) x\n   b) y\n\n## Answer key\n\n1. y\n");
    expect(worksheetMarkdown("W", { instructions: "", questions: [{ q: "Q", kind: "short", answer: "A" }] }, false)).not.toContain("Answer key");
  });

  it("writes a mind map as an outline", () => {
    expect(mindmapMarkdown({ label: "R", children: [{ label: "a", children: [{ label: "b", children: [] }] }] })).toBe("# R\n- a\n  - b\n");
  });
});

describe("mind map layout", () => {
  it("gives each leaf its own row and centres parents", () => {
    const { nodes, edges, height } = layoutMindmap({ label: "R", children: [{ label: "a", children: [{ label: "a1", children: [] }, { label: "a2", children: [] }] }, { label: "b", children: [] }] });
    const at = (l: string) => nodes.find((n) => n.label === l)!;
    expect(edges).toHaveLength(4);
    expect(at("a").y).toBe((at("a1").y + at("a2").y) / 2);
    expect(at("R").x).toBe(0);
    expect(at("a").x).toBeGreaterThan(at("R").w);
    expect(at("a1").x).toBeGreaterThan(at("a").x + at("a").w);
    expect(height).toBe(3 * 30 + 2 * 10);
  });

  it("wraps text by words", () => {
    expect(wrapText("one two three four", 9)).toEqual(["one two", "three", "four"]);
    expect(wrapText("", 9)).toEqual([]);
  });
});
