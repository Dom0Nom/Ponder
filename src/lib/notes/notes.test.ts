import { describe, expect, it } from "vitest";
import type { Note } from "../types";
import { applyCompletion, backlinks, brokenLinks, linkify, linkQueryAt, parseLinks, renameLinks, suggestions, uniqueTitle } from "./links";
import { glossaryPrompt, glossarySample, parseGlossary, textHash } from "./glossary";
import { cleanRewrite, levelPrompt, splitPassages, translatePrompt } from "./passages";

const note = (id: string, title: string, body = ""): Note => ({
  id,
  spaceId: "s",
  title,
  body,
  useAsSource: false,
  sourceId: null,
  createdAt: 0,
  updatedAt: 0,
});

describe("links", () => {
  it("parses unique titles in order", () => {
    expect(parseLinks("See [[Cells]] and [[ mitosis ]], again [[cells]]. [[ ]] [[a\nb]]")).toEqual(["Cells", "mitosis"]);
  });

  it("computes backlinks by normalized title and ignores the note itself", () => {
    const a = note("a", "Cells", "About [[Cells]] itself");
    const b = note("b", "Mitosis", "Part of [[cells]]");
    const c = note("c", "Other", "no links [Cells]");
    expect(backlinks([a, b, c], a).map((n) => n.id)).toEqual(["b"]);
    expect(backlinks([a, b, c], b)).toEqual([]);
  });

  it("lists links with no target", () => {
    const a = note("a", "A", "[[B]] [[Nope]]");
    expect(brokenLinks([a, note("b", "B")], a)).toEqual(["Nope"]);
  });

  it("finds the open link query at the caret", () => {
    expect(linkQueryAt("see [[Ce", 8)).toEqual({ start: 4, query: "Ce" });
    expect(linkQueryAt("see [[Cells]] x", 15)).toBeNull();
    expect(linkQueryAt("see [[Ce\nll", 11)).toBeNull();
    expect(linkQueryAt("no link", 5)).toBeNull();
  });

  it("suggests prefix matches first and skips the current note", () => {
    const ns = [note("1", "Cell theory"), note("2", "Plant cells"), note("3", "Cell cycle"), note("4", "Atoms")];
    expect(suggestions(ns, "cell", "3").map((n) => n.title)).toEqual(["Cell theory", "Plant cells"]);
    expect(suggestions(ns, "").length).toBe(4);
  });

  it("completes a link and moves the caret past it", () => {
    expect(applyCompletion("see [[Ce and more", 8, 4, "Cell theory")).toEqual({ body: "see [[Cell theory]] and more", caret: 19 });
    expect(applyCompletion("[[Ce]]x", 4, 0, "Cell")).toEqual({ body: "[[Cell]]x", caret: 8 });
  });

  it("renames links and linkifies for the preview", () => {
    expect(renameLinks("[[Old]] and [[old ]] and [[Other]]", "Old", "New")).toBe("[[New]] and [[New]] and [[Other]]");
    expect(linkify("[[Cells]] [[New one]]", [note("a", "cells")])).toBe("[Cells](#note=a) [New one](#new-note=New%20one)");
  });

  it("makes titles unique", () => {
    expect(uniqueTitle([note("1", "Untitled")], "Untitled")).toBe("Untitled 2");
    expect(uniqueTitle([note("1", "Untitled"), note("2", "untitled 2")], "Untitled")).toBe("Untitled 3");
    expect(uniqueTitle([], "Untitled")).toBe("Untitled");
  });
});

describe("glossary", () => {
  const text = "Mitochondria make ATP. The Calvin cycle fixes carbon dioxide in the stroma.";

  it("keeps only well formed, grounded, unique entries", () => {
    const reply = JSON.stringify({
      terms: [
        { term: "ATP", definition: "The energy carrier." },
        { term: "atp", definition: "Duplicate." },
        { term: "Ribosome", definition: "Not in the text." },
        { term: "Calvin cycle", definition: "" },
        { term: "stroma", definition: "Fluid inside the chloroplast." },
        "junk",
      ],
    });
    expect(parseGlossary(reply, text)).toEqual([
      { term: "ATP", definition: "The energy carrier." },
      { term: "stroma", definition: "Fluid inside the chloroplast." },
    ]);
  });

  it("accepts fenced JSON and a bare array, and rejects prose", () => {
    expect(parseGlossary('```json\n[{"term":"ATP","definition":"Energy."}]\n```', text)).toHaveLength(1);
    expect(parseGlossary("Sorry, I can't.", text)).toBeNull();
    expect(parseGlossary('{"terms":"x"}', text)).toBeNull();
  });

  it("starts with the stable first line and samples long texts", () => {
    expect(glossaryPrompt(text).split("\n")[0]).toBe("Extract a glossary of the key terms from the text below, for a learner who will study this text.");
    const long = "x".repeat(50_000);
    expect(glossarySample(long).length).toBeLessThan(15_000);
    expect(glossarySample(text)).toBe(text);
  });

  it("hashes text deterministically", () => {
    expect(textHash("a")).toBe(textHash("a"));
    expect(textHash("a")).not.toBe(textHash("b"));
  });
});

describe("passages", () => {
  it("groups paragraphs and keeps offsets into the original", () => {
    const text = "First paragraph.\n\nSecond one is here.\n\n" + "Long sentence. ".repeat(100).trim();
    const ps = splitPassages(text, 200);
    expect(ps.length).toBeGreaterThan(2);
    for (const p of ps) expect(text.slice(p.start, p.end)).toBe(p.text);
    expect(ps[0].text).toBe("First paragraph.\n\nSecond one is here.");
    expect(ps.every((p) => p.text.length <= 300)).toBe(true);
    for (let i = 1; i < ps.length; i++) expect(ps[i].start).toBeGreaterThanOrEqual(ps[i - 1].end);
  });

  it("handles empty text and text without blank lines", () => {
    expect(splitPassages("")).toEqual([]);
    expect(splitPassages("one\ntwo")).toEqual([{ start: 0, end: 7, text: "one\ntwo" }]);
  });

  it("builds prompts with stable first lines", () => {
    expect(levelPrompt("simpler", "P").split("\n")[0]).toMatch(/^Rewrite the passage below at a simpler reading level/);
    expect(levelPrompt("advanced", "P").split("\n")[0]).toMatch(/^Rewrite the passage below at a more advanced reading level/);
    expect(translatePrompt("German", "P").split("\n")[0]).toMatch(/^Translate the passage below into German/);
  });

  it("strips fences and wrapping quotes from replies", () => {
    expect(cleanRewrite("```\nHello\n```")).toBe("Hello");
    expect(cleanRewrite('"""\nHello\n"""')).toBe("Hello");
    expect(cleanRewrite("  \n ")).toBe("");
  });
});
