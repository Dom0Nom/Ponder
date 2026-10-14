import { MockLanguageModelV4 } from "ai/test";
import { generateText, stepCountIs } from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedModel } from "../chat/llm";
import type { Message, RangeRequest, Source, SourceRange, Thread } from "../types";

const h = vi.hoisted(() => ({
  sources: [] as Source[],
  saved: [] as { summary: string | null; until: number | null }[],
  searches: [] as string[][],
}));

function range(r: RangeRequest): SourceRange {
  const text = r.unit === "all" ? "Whole source text. ".repeat(20) : `Text of ${r.unit} ${r.from}-${r.to}. `.repeat(10);
  return { sourceId: r.sourceId, sourceTitle: r.sourceId === "alg" ? "Elementary Algebra" : "Biology", chunkId: 1, ordFrom: r.from ?? 0, ordTo: r.to ?? 0, start: 0, end: text.length, pageFrom: 40, pageTo: 41, heading: null, text, truncated: false, totalChunks: 300, totalPages: 900, pageStarts: [] };
}

vi.mock("../ipc", () => ({
  api: {
    listSources: async () => h.sources,
    sourceOutlines: async () => [
      { sourceId: "alg", method: "text", entries: [{ title: "Chapter 5: Systems of Equations", level: 1, ordFrom: 200, ordTo: 230, pageFrom: 543, pageTo: 640 }] },
    ],
    searchManyChunks: async (_s: string, queries: string[]) => {
      h.searches.push(queries);
      return queries.map(() => [{ chunkId: 9, sourceId: "bio", sourceTitle: "Biology", text: "cells", start: 0, end: 5, page: 3, score: 1, ord: 30 }]);
    },
    readSourceRanges: async (rs: RangeRequest[]) => rs.map((r) => ({ range: range(r), error: null })),
    saveThreadSummary: async (id: string, summary: string | null, until: number | null) => {
      h.saved.push({ summary, until });
      return { ...thread, id, summary, summaryUntil: until };
    },
    listOpenrouterModels: async () => ({ fetchedAt: 0, models: [] }),
  },
}));

import { buildContext, contextMessages, ContextOverflowError } from "./build";

const thread: Thread = { id: "t", spaceId: "sp", title: "T", createdAt: 0, updatedAt: 0, pinned: false, summary: null, summaryUntil: null, autoCompact: true };

function src(id: string, title: string, over: Partial<Source> = {}): Source {
  return { id, spaceId: "sp", title, kind: "pdf", origin: null, status: "ready", error: null, summary: `${title} summary.`, useInChat: true, progress: 1, charCount: 2_000_000, chunkCount: 300, createdAt: id === "alg" ? 1 : 2, updatedAt: 1, contextMode: "auto", ...over };
}

function model(reply: (prompt: string) => string, window = 32_000) {
  const prompts: string[] = [];
  const m = new MockLanguageModelV4({
    doGenerate: async (opts: unknown) => {
      const p = JSON.stringify((opts as { prompt: unknown }).prompt);
      prompts.push(p);
      return {
        content: [{ type: "text", text: reply(p) }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: { inputTokens: { total: 1, noCache: 1 }, outputTokens: { total: 1, text: 1 } },
        warnings: [],
      };
    },
  } as never);
  const provider = { id: "lm", type: "lmstudio", kind: "local", name: "LM", baseUrl: "http://127.0.0.1:1/v1", config: {}, createdAt: 0 };
  return { prompts, llm: { provider, modelId: `m${window}`, model: m, options: () => ({}) } as unknown as ResolvedModel };
}

const msg = (i: number, content: string): Message => ({ id: `m${i}`, threadId: "t", role: i % 2 ? "assistant" : "user", content, reasoning: null, citations: null, meta: null, status: "complete", error: null, createdAt: i });

const base = (llm: ResolvedModel) => ({
  spaceId: "sp",
  thread,
  prior: [] as Message[],
  latest: "What is a cell?",
  llm,
  instructions: ({ sourceMap, fullText }: { sourceMap: string; fullText: string }) => `SYSTEM\n${sourceMap}\n${fullText}`,
});

beforeEach(() => {
  h.sources = [src("alg", "Elementary Algebra"), src("bio", "Biology")];
  h.saved = [];
  h.searches = [];
  vi.stubGlobal("fetch", async () => new Response("", { status: 404 }));
});

describe("buildContext", () => {
  it("puts every source in the map and passages with the learner's message", async () => {
    const { llm } = model(() => "{}");
    const ctx = await buildContext(base(llm));
    expect(ctx.system).toContain('S1 "Elementary Algebra"');
    expect(ctx.system).toContain('S2 "Biology"');
    expect(ctx.userText).toMatch(/^Passages from my sources/);
    expect(ctx.userText).toContain("[1] (Biology, p. 40–41");
    expect(ctx.userText.endsWith("What is a cell?")).toBe(true);
    expect(ctx.citations[0]).toMatchObject({ n: 1, sourceId: "bio" });
    expect(ctx.stats.window).toBe(8192);
    expect(ctx.stats.used).toBeLessThan(8192);
    expect(contextMessages(ctx).at(-1)).toEqual({ role: "user", content: ctx.userText });
  });

  it("reads the chapter the learner asks for from the named source", async () => {
    const { llm } = model(() => '{"query":"summarize chapter 5 of elementary algebra","searches":[]}', 128_000);
    const ctx = await buildContext({ ...base(llm), latest: "Summarize chapter 5 of Elementary Algebra" });
    const p = ctx.book.passages.find((x) => x.why === "section");
    expect(p).toMatchObject({ sourceId: "alg", label: "Chapter 5: Systems of Equations" });
    expect(p!.text).toContain("chunk 200-230");
  });

  it("rewrites a follow-up into a standalone query using the conversation", async () => {
    const { llm, prompts } = model((p) => (p.includes("standalone") ? '{"query":"why do plant cells have walls","searches":["cell wall function"]}' : "x"));
    const prior = [msg(0, "Tell me about plant cells"), msg(1, "Plant cells have walls and chloroplasts.")];
    await buildContext({ ...base(llm), prior, latest: "and why is that?" });
    expect(prompts.some((p) => p.includes("Plant cells have walls"))).toBe(true);
    expect(h.searches[0]).toEqual(["why do plant cells have walls", "and why is that?", "cell wall function"]);
  });

  it("compacts a long thread with the helper model and keeps the last turns word for word", async () => {
    const { llm } = model((p) => (p.includes("compress") ? "- Covered: osmosis basics" : "{}"));
    const prior = Array.from({ length: 30 }, (_, i) => msg(i, `turn ${i} ${"lorem ipsum dolor ".repeat(60)}`));
    const ctx = await buildContext({ ...base(llm), prior });
    expect(h.saved).toHaveLength(1);
    expect(h.saved[0].summary).toContain("osmosis basics");
    expect(ctx.history[0].content).toContain("osmosis basics");
    expect(ctx.history.map((m) => m.content).join("\n")).toContain("turn 29");
    expect(ctx.history.map((m) => m.content).join("\n")).not.toContain("turn 2 ");
    expect(ctx.stats.conversation.summarized).toBe(true);
  });

  it("says so instead of dropping turns when compaction is off and the chat doesn't fit", async () => {
    const { llm } = model(() => "{}");
    const prior = Array.from({ length: 30 }, (_, i) => msg(i, `turn ${i} ${"lorem ipsum dolor ".repeat(60)}`));
    await expect(buildContext({ ...base(llm), prior, thread: { ...thread, autoCompact: false } })).rejects.toBeInstanceOf(ContextOverflowError);
    expect(h.saved).toHaveLength(0);
  });

  it("puts full-text sources in the system prompt and leaves summary-only sources out of search", async () => {
    h.sources = [src("alg", "Elementary Algebra", { contextMode: "full" }), src("bio", "Biology", { contextMode: "summary" })];
    const { llm } = model(() => "{}", 128_000);
    const ctx = await buildContext(base(llm));
    expect(ctx.system).toContain("Whole source text.");
    expect(ctx.stats.full).toEqual(["Elementary Algebra"]);
    expect(ctx.stats.summaryOnly).toEqual(["Biology"]);
    expect(h.searches).toHaveLength(0);
  });
});

describe("reading tools", () => {
  it("lets the model read pages on demand and cites what it read", async () => {
    let step = 0;
    const toolModel = new MockLanguageModelV4({
      doGenerate: async () => {
        step++;
        if (step === 1)
          return {
            content: [{ type: "tool-call", toolCallId: "c1", toolName: "read_source", input: JSON.stringify({ source: "S1", pages: "40-52" }) }],
            finishReason: { unified: "tool-calls", raw: "tool_calls" },
            usage: { inputTokens: { total: 1, noCache: 1 }, outputTokens: { total: 1, text: 1 } },
            warnings: [],
          };
        return { content: [{ type: "text", text: "Answer [2]." }], finishReason: { unified: "stop", raw: "stop" }, usage: { inputTokens: { total: 1, noCache: 1 }, outputTokens: { total: 1, text: 1 } }, warnings: [] };
      },
    } as never);
    const { llm } = model(() => "{}", 128_000);
    const provider = { id: "or", type: "anthropic", kind: "apiKey", name: "A", baseUrl: null, config: {}, createdAt: 0 };
    const activity: string[] = [];
    const ctx = await buildContext({ ...base({ ...llm, provider, modelId: "claude-x" } as never), helper: llm, tools: true, onActivity: (a) => activity.push(a) });
    expect(ctx.tools).not.toBeNull();
    const before = ctx.book.passages.length;
    const r = await generateText({ model: toolModel, tools: ctx.tools!, prompt: "q", stopWhen: stepCountIs(4) });
    expect(r.text).toBe("Answer [2].");
    expect(ctx.book.passages.length).toBeGreaterThan(before);
    expect(ctx.finalCitations().at(-1)).toMatchObject({ sourceId: "alg", n: ctx.book.passages.length });
    expect(activity).toEqual(["Reading Elementary Algebra, p. 40–52"]);
  });
});
