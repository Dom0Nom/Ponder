import { describe, expect, it } from "vitest";
import { fold, pageRange, quoteInLayer, selectionToOffsets } from "./pdfAnchor";

const text = "Cells need energy.\n\nOsmosis moves water across a mem-\nbrane. Osmosis is passive.\n\nThe ﬁnal page.";
const pages: [number, number][] = [
  [1, 0],
  [2, 20],
  [3, text.indexOf("The")],
];

describe("pdfAnchor", () => {
  it("folds whitespace, hyphens and ligatures", () => {
    const f = fold("a ﬁ-\nb");
    expect(f.norm).toBe("afib");
    expect(f.map).toEqual([0, 2, 2, 5]);
  });

  it("finds the page range", () => {
    expect(pageRange(pages, 2, text.length)).toEqual([20, pages[2][1]]);
    expect(pageRange(pages, 3, text.length)).toEqual([pages[2][1], text.length]);
    expect(pageRange(null, 1, 9)).toEqual([0, 9]);
  });

  it("maps a selection across a hyphenated line break", () => {
    const r = selectionToOffsets(text, pageRange(pages, 2, text.length), "across a membrane.")!;
    expect(text.slice(r.start, r.end)).toBe("across a mem-\nbrane.");
  });

  it("picks the chosen copy on the page and falls back to the whole text", () => {
    const range = pageRange(pages, 2, text.length);
    expect(selectionToOffsets(text, range, "Osmosis", 1)!.start).toBe(text.lastIndexOf("Osmosis"));
    expect(selectionToOffsets(text, range, "Cells need")).toEqual({ start: 0, end: 10 });
    expect(selectionToOffsets(text, range, "final")).toEqual({ start: text.indexOf("ﬁnal"), end: text.indexOf("ﬁnal") + 4 });
    expect(selectionToOffsets(text, range, "  ")).toBeNull();
    expect(selectionToOffsets(text, range, "nowhere")).toBeNull();
  });

  it("finds a quote in the text layer", () => {
    const layer = fold("Osmosis moves water across a mem- brane.");
    expect(quoteInLayer(layer, "across a mem-\nbrane")).toEqual([[17, 32]]);
  });
});
