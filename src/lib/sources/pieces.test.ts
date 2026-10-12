import { describe, expect, it } from "vitest";
import { anchorAnnotations, buildPieces } from "./pieces";

describe("source viewer pieces", () => {
  const st = { text: "Page one text. Über Grün 🌱 here.\nPage two starts.", pages: [[1, 0], [2, 34]] as [number, number][] };

  it("highlights exactly the cited range and keeps page labels", () => {
    const start = st.text.indexOf("Grün");
    const end = start + "Grün 🌱".length;
    const pieces = buildPieces(st, start, end);
    expect(pieces.filter((p) => p.mark).map((p) => p.text).join("")).toBe("Grün 🌱");
    expect(pieces.map((p) => p.text).join("")).toBe(st.text);
    expect(pieces.filter((p) => p.page != null).map((p) => p.page)).toEqual([1, 2]);
  });

  it("splits a highlight that crosses a page boundary", () => {
    const pieces = buildPieces(st, 30, 40);
    expect(pieces.filter((p) => p.mark).map((p) => p.text).join("")).toBe(st.text.slice(30, 40));
  });

  it("ignores missing or invalid ranges", () => {
    expect(buildPieces({ text: "abc", pages: null }).some((p) => p.mark)).toBe(false);
    expect(buildPieces({ text: "abc", pages: null }, 5, 9).some((p) => p.mark)).toBe(false);
  });
});

describe("learner highlights", () => {
  const text = "Plants make sugar. Plants need light. Animals eat plants.";
  const ann = (id: string, quote: string, start: number) => ({ id, sourceId: "s", start, end: start + quote.length, quote, note: "", createdAt: 0, updatedAt: 0 });

  it("cuts pieces at highlights and tags them with the highlight id", () => {
    const a = ann("a", "need light", text.indexOf("need light"));
    const pieces = buildPieces({ text, pages: null }, undefined, undefined, [a]);
    expect(pieces.map((p) => p.text).join("")).toBe(text);
    expect(pieces.filter((p) => p.annot === "a").map((p) => p.text).join("")).toBe("need light");
    for (const p of pieces) expect(text.slice(p.start, p.start + p.text.length)).toBe(p.text);
  });

  it("keeps matching ranges, re-anchors moved quotes to the nearest copy, and detaches lost ones", () => {
    const moved = "Note: " + text;
    const [kept] = anchorAnnotations(text, [ann("k", "Plants", 19)]);
    expect([kept.start, kept.detached]).toEqual([19, false]);
    const [re] = anchorAnnotations(moved, [ann("r", "Plants", 19)]);
    expect(moved.slice(re.start, re.end)).toBe("Plants");
    expect(re.start).toBe(moved.indexOf("Plants", 20));
    const [lost] = anchorAnnotations(text, [ann("l", "photosynthesis", 3)]);
    expect([lost.start, lost.detached]).toEqual([-1, true]);
  });
});
