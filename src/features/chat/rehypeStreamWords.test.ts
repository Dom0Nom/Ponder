import { describe, expect, it } from "vitest";
import type { Element, Root, Text } from "hast";
import { rehypeStreamWords } from "./rehypeStreamWords";

const text = (value: string): Text => ({ type: "text", value });
const el = (tagName: string, children: (Element | Text)[], className?: string[]): Element => ({
  type: "element",
  tagName,
  properties: className ? { className } : {},
  children,
});
const run = (tree: Root) => (rehypeStreamWords()(tree), tree);

describe("rehypeStreamWords", () => {
  it("wraps each word and keeps whitespace as plain text", () => {
    const p = el("p", [text("Hello  big world")]);
    run({ type: "root", children: [p] });
    const kinds = p.children.map((c) => (c.type === "text" ? JSON.stringify(c.value) : ((c as Element).children[0] as Text).value));
    expect(kinds).toEqual(["Hello", JSON.stringify("  "), "big", JSON.stringify(" "), "world"]);
    const first = p.children[0] as Element;
    expect(first.properties?.className).toEqual(["t-stream-w", "is-in"]);
  });

  it("leaves code, pre and KaTeX untouched", () => {
    const code = el("code", [text("a b")]);
    const pre = el("pre", [el("code", [text("c d")])]);
    const katex = el("span", [text("x y")], ["katex"]);
    run({ type: "root", children: [el("p", [code, pre, katex])] });
    expect(code.children).toEqual([text("a b")]);
    expect((pre.children[0] as Element).children).toEqual([text("c d")]);
    expect(katex.children).toEqual([text("x y")]);
  });

  it("wraps words inside inline elements", () => {
    const em = el("em", [text("two words")]);
    run({ type: "root", children: [el("p", [em])] });
    expect(em.children.filter((c) => c.type === "element")).toHaveLength(2);
  });
});
