import { describe, expect, it } from "vitest";
import { bionicSegments } from "./bionic";

const bolds = (t: string) => bionicSegments(t).filter((s) => s.bold).map((s) => s.text);
const joined = (t: string) => bionicSegments(t).map((s) => s.text).join("");

describe("bionicSegments", () => {
  it("bolds half the letters rounded up, one letter for short words", () => {
    expect(bolds("a to the word reading")).toEqual(["a", "t", "t", "wo", "read"]);
  });

  it("keeps the text intact", () => {
    const t = "Hello, world! It's 3.14 — see https://x.org/a?b=1 or www.a.de, ok.\n\nNext  line";
    expect(joined(t)).toBe(t);
  });

  it("ignores punctuation around words", () => {
    expect(bolds("(hello), “world”...")).toEqual(["hel", "wor"]);
  });

  it("treats apostrophes as part of the word", () => {
    expect(bolds("don't can’t")).toEqual(["do", "ca"]);
  });

  it("bolds each part of a hyphenated word", () => {
    expect(bolds("well-known state-of-the-art")).toEqual(["we", "kno", "sta", "o", "t", "a"]);
  });

  it("handles umlauts and other scripts", () => {
    expect(bolds("Über Grüße")).toEqual(["Üb", "Grü"]);
    expect(bolds("Привет мир")).toEqual(["При", "м"]);
  });

  it("does not split combining marks from their letter", () => {
    const t = "café noël";
    expect(joined(t)).toBe(t);
    expect(bolds("café")).toEqual(["ca"]);
    expect(bolds("éééé")).toEqual(["éé"]);
  });

  it("leaves numbers, mixed tokens and URLs untouched", () => {
    expect(bolds("42 3.14 abc123 1st")).toEqual([]);
    expect(bolds("see https://example.com/path and www.example.com now")).toEqual(["s", "a", "n"]);
  });

  it("handles empty and whitespace-only input", () => {
    expect(bionicSegments("")).toEqual([]);
    expect(bionicSegments("  \n ")).toEqual([{ text: "  \n ", bold: false }]);
  });
});
