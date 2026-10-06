import { describe, expect, it } from "vitest";
import { buildPieces } from "./pieces";

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
