import { describe, expect, it } from "vitest";
import type { Message, Source, SourceOutline, SourceRange } from "../types";
import { splitBudget, withConversationUsed } from "./budget";
import { compactionCut, fitHistory, KEEP_TURNS } from "./history";
import { parsePlan, resolveSections, sectionRefs, namedSources } from "./plan";
import { blocks, expandHits, fuse, numberRanges } from "./retrieve";
import { buildSourceMap, makeHandles } from "./sourceMap";
import { estimateTokens, truncateToTokens } from "./tokens";
import { billingOf, catalogMatch, estimateCost, limitsFrom, type ModelLimits } from "./window";
import { partition } from "./compact";
import { wantsPlan } from "./build";
import { parseSpan } from "./tools";

const limits = (over: Partial<ModelLimits> = {}): ModelLimits => ({ window: 128_000, maxOutput: 8192, pricing: null, billing: "paid", from: "table", ...over });

function msg(i: number, role: Message["role"], content: string): Message {
  return { id: `m${i}`, threadId: "t", role, content, reasoning: null, citations: null, meta: null, status: "complete", error: null, createdAt: i };
}

function src(id: string, title: string, over: Partial<Source> = {}): Source {
  return { id, spaceId: "sp", title, kind: "pdf", origin: null, status: "ready", error: null, summary: `About ${title}. More detail here.`, useInChat: true, progress: 1, charCount: 400_000, chunkCount: 500, createdAt: 1, updatedAt: 1, ...over };
}

describe("budget", () => {
  it("caps paid models at the setting and leaves free, subscription and local models their full window", () => {
    const paid = splitBudget({ limits: limits({ window: 1_000_000 }), maxContext: 200_000, fixedTokens: 2_000 });
    expect(paid.cap).toBe(200_000);
    expect(paid.capped).toBe(true);
    for (const billing of ["free", "subscription", "local"] as const) {
      const b = splitBudget({ limits: limits({ window: 1_000_000, billing }), maxContext: 200_000, fixedTokens: 2_000 });
      expect(b.cap).toBe(1_000_000);
    }
  });

  it("splits what's left between conversation and sources and keeps an answer reserve", () => {
    const b = splitBudget({ limits: limits(), fixedTokens: 3_000 });
    expect(b.answer).toBe(8192);
    expect(b.conversation + b.sources + b.answer + b.fixed).toBeLessThanOrEqual(128_000);
    expect(b.sources).toBeGreaterThan(b.conversation);
    expect(withConversationUsed(b, 1_000).sources).toBe(b.sources + b.conversation - 1_000);
  });

  it("still works for an 8k local window", () => {
    const b = splitBudget({ limits: limits({ window: 8192, maxOutput: 2048, billing: "local" }), fixedTokens: 1_500 });
    expect(b.answer).toBeLessThanOrEqual(2048);
    expect(b.conversation).toBeGreaterThan(500);
    expect(b.sources).toBeGreaterThan(1_000);
  });
});

describe("model limits", () => {
  it("reads window, output and price from the OpenRouter catalog and knows free models", () => {
    const or = { id: "x/y", name: "Y", contextLength: 1_000_000, supportedParameters: [], created: null, pricing: { prompt: 1e-6, completion: 2e-6, cacheRead: 1e-7 }, maxOutput: 65_000 };
    const p = { id: "p", type: "openrouter", kind: "apiKey", name: "OR", baseUrl: null, config: {}, createdAt: 0 } as never;
    const l = limitsFrom(p, "x/y", or);
    expect(l).toMatchObject({ window: 1_000_000, maxOutput: 65_000, billing: "paid", from: "catalog" });
    expect(estimateCost(l, 100_000, 1_000)).toBeCloseTo(0.102);
    expect(estimateCost(l, 100_000, 0, 100_000)).toBeCloseTo(0.01);
    expect(billingOf(p, "x/y:free")).toBe("free");
    expect(billingOf({ type: "openai-compatible", kind: "apiKey", baseUrl: "http://192.168.1.5:1234/v1" }, "q")).toBe("local");
    expect(billingOf({ type: "chatgpt-oauth", kind: "oauth", baseUrl: null }, "gpt-5")).toBe("subscription");
  });

  it("matches a direct API model to its catalog entry and falls back to the table", () => {
    const list = [{ id: "anthropic/claude-sonnet-4.5", name: "", contextLength: 1_000_000, supportedParameters: [], created: null }];
    expect(catalogMatch({ type: "anthropic" }, "claude-sonnet-4-5-20250929", list)?.id).toBe("anthropic/claude-sonnet-4.5");
    const p = { type: "openai", kind: "apiKey", baseUrl: null } as never;
    expect(limitsFrom(p, "gpt-4.1-mini").window).toBe(1_047_576);
    expect(limitsFrom({ type: "lmstudio", kind: "local", baseUrl: null } as never, "qwen").window).toBe(8192);
  });
});

describe("conversation history", () => {
  const long = (i: number) => msg(i, i % 2 ? "assistant" : "user", "word ".repeat(400));

  it("sends every turn when it fits: no turn limit", () => {
    const msgs = Array.from({ length: 60 }, (_, i) => msg(i, i % 2 ? "assistant" : "user", `turn ${i}`));
    const h = fitHistory(msgs, null, 100_000);
    expect(h.messages).toHaveLength(60);
    expect(h.shouldCompact).toBe(false);
  });

  it("asks for compaction near the budget and cuts before the last turns", () => {
    const msgs = Array.from({ length: 20 }, (_, i) => long(i));
    const h = fitHistory(msgs, { summary: null, summaryUntil: null, autoCompact: true }, 5_000);
    expect(h.shouldCompact).toBe(true);
    expect(h.overflow).toBe(false);
    const cut = compactionCut(h.live)!;
    const kept = h.live.filter((m) => m.createdAt > cut.createdAt);
    expect(kept.filter((m) => m.role === "user")).toHaveLength(KEEP_TURNS);
    expect(kept[0].role).toBe("user");
  });

  it("replaces summarized messages with the summary and chains later compactions", () => {
    const msgs = Array.from({ length: 10 }, (_, i) => msg(i, i % 2 ? "assistant" : "user", `turn ${i}`));
    const h = fitHistory(msgs, { summary: "Learner knows fractions.", summaryUntil: 5, autoCompact: true }, 100_000);
    expect(h.summarized).toBe(true);
    expect(h.messages[0].content).toContain("Learner knows fractions.");
    expect(h.messages[0].content).toContain("turn 6");
    expect(h.messages.map((m) => m.content).join()).not.toContain("turn 5");
    expect(h.live.map((m) => m.id)).toEqual(["m6", "m7", "m8", "m9"]);
  });

  it("reports overflow instead of dropping when compaction is off", () => {
    const msgs = Array.from({ length: 20 }, (_, i) => long(i));
    const h = fitHistory(msgs, { summary: null, summaryUntil: null, autoCompact: false }, 3_000);
    expect(h.shouldCompact).toBe(false);
    expect(h.overflow).toBe(true);
    expect(h.messages).toHaveLength(20);
  });

  it("splits long transcripts into parts for summarizing", () => {
    const parts = partition(["a ".repeat(500), "b ".repeat(500), "c ".repeat(500)], 600);
    expect(parts.length).toBeGreaterThanOrEqual(2);
    expect(parts.join("")).toContain("c c");
  });
});

describe("search planning", () => {
  it("parses the plan and drops duplicates of the query", () => {
    expect(parsePlan('```json\n{"query":"photosynthesis light reactions","searches":["light reactions","Calvin cycle","light reactions"]}\n```', "x")).toEqual({
      query: "photosynthesis light reactions",
      searches: ["light reactions", "Calvin cycle"],
    });
    expect(parsePlan("not json", "fallback")).toEqual({ query: "fallback", searches: [] });
    expect(parsePlan('{"query":"q","searches":["aa","bb","cc","dd","ee","ff","gg"]}', "x").searches).toHaveLength(5);
  });

  it("plans follow-ups and broad questions, not short first questions", () => {
    expect(wantsPlan("and why does that happen?", [{ role: "user", content: "x" }])).toBe(true);
    expect(wantsPlan("What is osmosis?", [])).toBe(false);
    expect(wantsPlan("Compare mitosis and meiosis", [])).toBe(true);
    expect(wantsPlan("Fasse Kapitel 5 zusammen", [])).toBe(true);
  });

  it("finds chapter, section and page references in English and German", () => {
    expect(sectionRefs("summarize chapter 5")).toEqual([{ kind: "chapter", from: 5, to: 5 }]);
    expect(sectionRefs("Kapitel 2 bis 3")).toEqual([{ kind: "chapter", from: 2, to: 3 }]);
    expect(sectionRefs("what's on pages 40-52")).toEqual([{ kind: "page", from: 40, to: 52 }]);
    expect(sectionRefs("explain section 4.3")).toEqual([{ kind: "section", from: 4, to: 4, label: "4.3" }]);
    expect(sectionRefs("it costs 2.5 kg")).toEqual([]);
  });

  it("resolves a chapter against the outline of the source the learner names", () => {
    const algebra = src("a", "OpenStax Elementary Algebra 2e (Rice University).pdf");
    const bio = src("b", "Concepts of Biology");
    const outlines = new Map<string, SourceOutline>([
      ["a", { sourceId: "a", method: "text", entries: [
        { title: "Chapter 4: Graphs", level: 1, ordFrom: 100, ordTo: 199, pageFrom: 393, pageTo: 540 },
        { title: "Chapter 5: Systems", level: 1, ordFrom: 200, ordTo: 260, pageFrom: 543, pageTo: 640 },
      ] }],
      ["b", { sourceId: "b", method: "toc", entries: [{ title: "Chapter 5 Photosynthesis", level: 1, ordFrom: 10, ordTo: 40, pageFrom: 99, pageTo: 120 }] }],
    ]);
    expect(namedSources("summarize chapter 5 of elementary algebra", [algebra, bio]).map((s) => s.id)).toEqual(["a"]);
    expect(resolveSections("summarize chapter 5 of elementary algebra", [algebra, bio], outlines)).toEqual([
      { sourceId: "a", unit: "chunk", from: 200, to: 260, label: "Chapter 5: Systems" },
    ]);
    // ambiguous without a named source
    expect(resolveSections("summarize chapter 5", [algebra, bio], outlines)).toEqual([]);
    expect(resolveSections("summarize chapter 4", [algebra, bio], outlines)[0]?.label).toBe("Chapter 4: Graphs");
  });
});

describe("passages", () => {
  const hit = (chunkId: number, sourceId: string, ord: number) => ({ chunkId, sourceId, sourceTitle: sourceId, text: "t", start: 0, end: 1, page: null, score: 1, ord });

  it("ranks chunks several queries found higher", () => {
    const r = fuse([[hit(1, "a", 1), hit(2, "a", 2)], [hit(2, "a", 2), hit(3, "b", 0)]]);
    expect(r[0].hit.chunkId).toBe(2);
  });

  it("expands hits to whole small sources, short sections or neighbours and merges overlaps", () => {
    const sources = new Map([
      ["small", src("small", "Small", { charCount: 4_000, chunkCount: 5 })],
      ["big", src("big", "Big")],
    ]);
    const outlines = new Map<string, SourceOutline>([["big", { sourceId: "big", method: "toc", entries: [{ title: "1.2 Short", level: 2, ordFrom: 10, ordTo: 13, pageFrom: 5, pageTo: 6 }] }]]);
    const ranked = fuse([[hit(1, "small", 2), hit(2, "big", 11), hit(3, "big", 50), hit(4, "big", 51)]]);
    const ranges = expandHits(ranked, { budget: 20_000, sources, outlines });
    expect(ranges).toEqual([
      expect.objectContaining({ sourceId: "small", all: true }),
      expect.objectContaining({ sourceId: "big", from: 10, to: 13, label: "1.2 Short" }),
      expect.objectContaining({ sourceId: "big", from: 49, to: 52 }),
    ]);
  });

  const range = (text: string, over: Partial<SourceRange> = {}): SourceRange => ({
    sourceId: "s", sourceTitle: "Book", chunkId: 7, ordFrom: 0, ordTo: 3, start: 100, end: 100 + text.length, pageFrom: 3, pageTo: 4, heading: null, text, truncated: false, totalChunks: 4, totalPages: 9, pageStarts: [[4, 100 + 4500]], ...over,
  });

  it("splits long ranges into numbered blocks with their own pages and offsets", () => {
    const text = `${"a".repeat(3000)}\n${"b".repeat(3000)}\n${"c".repeat(3000)}`;
    const bs = blocks(range(text));
    expect(bs.length).toBe(3);
    expect(bs[0]).toMatchObject({ start: 100, page: 3 });
    expect(bs[2].page).toBe(4);
    const n = numberRanges([{ range: range(text), label: "Ch 1", why: "search" }], 100_000, 5);
    expect(n.passages.map((p) => p.n)).toEqual([5, 6, 7]);
  });

  it("numbers each chunk separately so citations point at the chunk, merging only for huge budgets", () => {
    const text = "First chunk text.\nSecond chunk text.\nThird chunk text.";
    const r = range(text, { chunkStarts: [[11, 100], [12, 118], [13, 137]], pageStarts: [] });
    expect(blocks(r).map((b) => [b.text, b.chunkId, b.start])).toEqual([
      ["First chunk text.", 11, 100],
      ["Second chunk text.", 12, 118],
      ["Third chunk text.", 13, 137],
    ]);
    expect(blocks(r, 30).map((b) => b.chunkId)).toEqual([11, 13]);
  });

  it("cuts the last passage with a notice when the budget runs out", () => {
    const n = numberRanges([{ range: range("word ".repeat(4000)), label: null, why: "full" }], 900);
    expect(n.truncated).toEqual(["Book"]);
    expect(n.passages[n.passages.length - 1].text).toContain("[truncated to fit the context]");
    expect(n.tokens).toBeLessThanOrEqual(900);
  });
});

describe("source map", () => {
  it("lists every source and falls back to titles, then a count, as the budget shrinks", () => {
    const list = Array.from({ length: 300 }, (_, i) => src(`s${i}`, `Source number ${i}`, { summary: "A long summary sentence about this source. ".repeat(4), createdAt: i }));
    const handles = makeHandles(list);
    const full = buildSourceMap(list, new Map(), handles, 1_000_000);
    expect(full.level).toBe("full");
    expect(full.text).toContain("S300");
    const titles = buildSourceMap(list, new Map(), handles, 4_500);
    expect(titles.level).toBe("titles");
    const tiny = buildSourceMap(list, new Map(), handles, 500);
    expect(tiny.omitted).toBeGreaterThan(0);
    expect(tiny.text).toContain("list_sources");
  });
});

describe("tokens and tools", () => {
  it("estimates by script and truncates at sentence ends", () => {
    expect(estimateTokens("abcd".repeat(100))).toBe(100);
    expect(estimateTokens("漢字".repeat(50))).toBe(100);
    const t = truncateToTokens("One sentence here. Another one follows. And a third one ends it.", 6);
    expect(t.truncated).toBe(true);
    expect(t.text.endsWith(".")).toBe(true);
  });

  it("parses page and chunk spans", () => {
    expect(parseSpan("40-52")).toEqual([40, 52]);
    expect(parseSpan(" 7 ")).toEqual([7, 7]);
    expect(parseSpan("52–40")).toEqual([40, 52]);
    expect(parseSpan("chapter")).toBeNull();
  });
});
