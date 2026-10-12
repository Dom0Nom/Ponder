import { MockLanguageModelV4 } from "ai/test";
import { describe, expect, it, vi } from "vitest";
import type { ResolvedModel } from "../chat/llm";
import type { HttpFn } from "../importers/youtube";
import { deepResearch, writeReport, type ResearchDeps } from "./deepResearch";
import { DEFAULT_SEARCH } from "./search";

const userText = (opts: unknown) => {
  const m = (opts as { prompt: { role: string; content: unknown }[] }).prompt.filter((x) => x.role === "user").at(-1);
  return Array.isArray(m?.content) ? m.content.map((p: { text?: string }) => p.text ?? "").join("") : String(m?.content ?? "");
};

function fakeLlm(reply: (user: string) => string) {
  const seen: string[] = [];
  const model = new MockLanguageModelV4({
    doGenerate: async (opts: unknown) => {
      const user = userText(opts);
      seen.push(user);
      return {
        content: [{ type: "text", text: reply(user) }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: { inputTokens: { total: 1, noCache: 1 }, outputTokens: { total: 1, text: 1 } },
        warnings: [],
      };
    },
  } as never);
  return { seen, llm: { model, modelId: "m", options: () => ({}) } as unknown as ResolvedModel };
}

const ddgOnly = { ...DEFAULT_SEARCH, free: { duckduckgo: true, wikipedia: false, arxiv: false, openalex: false, openstax: false } };

const hit = (url: string) => `<div><a class="result__a" href="${url}">T ${url}</a><a class="result__snippet" href="x">s</a></div>`;

/** DuckDuckGo answers per query; anything else is empty. */
const web = (byQuery: Record<string, string[]>): HttpFn =>
  vi.fn(async (url) => {
    const q = new URL(url).searchParams.get("q") ?? "";
    return { status: 200, body: (byQuery[q] ?? []).map(hit).join("") };
  });

const base = (llm: ResolvedModel, http: HttpFn, extra: Partial<ResearchDeps> = {}) => {
  const fetched: string[] = [];
  const deps: ResearchDeps = {
    llm,
    http,
    search: ddgOnly,
    fetchPage: async (url) => {
      fetched.push(url);
      return { url, title: `Page ${url}`, markdown: `Text of ${url}`, excerpt: null, byline: null, siteName: null };
    },
    ...extra,
  };
  return { deps, fetched };
};

const rankAll = (user: string) =>
  JSON.stringify([...user.matchAll(/^### (\d+)$/gm)].map((m) => ({ i: Number(m[1]), answers: true, relevance: 80, credibility: 70, summary: "s" })));

describe("skipping sources already in the space", () => {
  it("never fetches or keeps a url the space already has, ignoring www, tracking and trailing slash", async () => {
    const { llm } = fakeLlm((u) => (u.startsWith("A learner wants") ? '{"language":"en","queries":["q1"]}' : u.startsWith("The learner's") ? rankAll(u) : '{"gaps":[],"queries":[]}'));
    const { deps, fetched } = base(llm, web({ q1: ["https://example.org/a", "https://example.org/b"] }), {
      skipUrls: ["https://www.example.org/a/?utm_source=x#top"],
    });
    const found = await deepResearch("question", deps);
    expect(fetched).toEqual(["https://example.org/b"]);
    expect(found.map((f) => f.url)).toEqual(["https://example.org/b"]);
  });
});

describe("rounds with gap finding", () => {
  const plan = '{"language":"en","queries":["q1"]}';

  it("runs a second round for the gaps, dedupes across rounds and stops when nothing is missing", async () => {
    let gapCalls = 0;
    const { llm, seen } = fakeLlm((u) => {
      if (u.startsWith("A learner wants")) return plan;
      if (u.startsWith("The learner's")) return rankAll(u);
      gapCalls++;
      return gapCalls === 1 ? '{"gaps":["how it is regulated"],"queries":["q2"]}' : '{"gaps":[],"queries":[]}';
    });
    const stages: string[] = [];
    const { deps, fetched } = base(llm, web({ q1: ["https://x.org/a", "https://x.org/b"], q2: ["https://x.org/b", "https://x.org/c"] }), {
      onStage: (st, d, round) => stages.push(`${round}:${st}${d ? `:${d}` : ""}`),
    });
    const found = await deepResearch("question", deps);
    expect(found.map((f) => f.url).sort()).toEqual(["https://x.org/a", "https://x.org/b", "https://x.org/c"]);
    expect(fetched.slice().sort()).toEqual(["https://x.org/a", "https://x.org/b", "https://x.org/c"]);
    expect(stages).toContain("1:searching:q1");
    expect(stages).toContain("2:searching:how it is regulated");
    expect(stages.at(-1)).toBe("undefined:done");
    expect(gapCalls).toBe(2);
    const gapPrompt = seen.find((u) => u.startsWith("Find what a learner's"))!;
    expect(gapPrompt).toContain("- q1");
    expect(gapPrompt).toContain("Page https://x.org/a");
  });

  it("stops early when the gap query finds nothing new", async () => {
    let gapCalls = 0;
    const { llm } = fakeLlm((u) => {
      if (u.startsWith("A learner wants")) return plan;
      if (u.startsWith("The learner's")) return rankAll(u);
      gapCalls++;
      return '{"gaps":["g"],"queries":["q2"]}';
    });
    const { deps } = base(llm, web({ q1: ["https://x.org/a"], q2: ["https://x.org/a"] }));
    const found = await deepResearch("question", deps);
    expect(found).toHaveLength(1);
    expect(gapCalls).toBe(1);
  });

  it("does at most three rounds in total", async () => {
    let n = 0;
    const { llm } = fakeLlm((u) => {
      if (u.startsWith("A learner wants")) return plan;
      if (u.startsWith("The learner's")) return rankAll(u);
      return `{"gaps":["g"],"queries":["q${++n + 1}"]}`;
    });
    const { deps, fetched } = base(llm, web({ q1: ["https://x.org/1"], q2: ["https://x.org/2"], q3: ["https://x.org/3"], q4: ["https://x.org/4"] }));
    const found = await deepResearch("question", deps);
    expect(found.map((f) => f.url).sort()).toEqual(["https://x.org/1", "https://x.org/2", "https://x.org/3"]);
    expect(fetched).toHaveLength(3);
  });

  it("asks for new queries when the first round kept nothing", async () => {
    let gapCalls = 0;
    const { llm, seen } = fakeLlm((u) => {
      if (u.startsWith("A learner wants")) return plan;
      if (u.startsWith("The learner's")) return rankAll(u).replace(/"relevance":80/g, '"relevance":10');
      gapCalls++;
      return gapCalls === 1 ? '{"gaps":["all"],"queries":["q2"]}' : '{"gaps":[],"queries":[]}';
    });
    const { deps } = base(llm, web({ q1: ["https://x.org/a"], q2: ["https://x.org/b"] }), { maxRounds: 2 });
    const found = await deepResearch("question", deps);
    expect(found).toEqual([]);
    expect(seen.find((u) => u.startsWith("Find what a learner's"))).toContain("(none kept yet)");
    expect(gapCalls).toBe(1);
  });

  it("keeps the first round's result when a later search or gap call fails", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { llm } = fakeLlm((u) => {
      if (u.startsWith("A learner wants")) return plan;
      if (u.startsWith("The learner's")) return rankAll(u);
      throw new Error("model down");
    });
    const { deps } = base(llm, web({ q1: ["https://x.org/a"] }));
    const found = await deepResearch("question", deps);
    expect(found.map((f) => f.url)).toEqual(["https://x.org/a"]);
    warn.mockRestore();
  });

  it("aborts with an AbortError", async () => {
    const ctrl = new AbortController();
    const { llm } = fakeLlm((u) => {
      if (u.startsWith("A learner wants")) return plan;
      ctrl.abort();
      return rankAll(u);
    });
    const { deps } = base(llm, web({ q1: ["https://x.org/a"] }), { signal: ctrl.signal });
    await expect(deepResearch("question", deps)).rejects.toThrow();
  });
});

describe("writeReport", () => {
  it("cleans the model's report against the chosen sources", async () => {
    const { llm, seen } = fakeLlm(() => "# Mitosis\n\nIt divides nuclei [1] and more [4].\n\n## Not covered\n\nRegulation.");
    const out = await writeReport("What is mitosis?", [{ id: "a", title: "Mitosis", url: "https://a.org/m", engine: "duckduckgo", summary: "", credibility: 80, relevance: 90, markdown: "text" }], { llm });
    expect(seen[0]).toContain('<source n="1" title="Mitosis" url="https://a.org/m">');
    expect(out.cited).toEqual([1]);
    expect(out.markdown).toContain("It divides nuclei [1] and more.");
    expect(out.markdown).toContain("- [1] Mitosis — https://a.org/m");
  });

  it("refuses an empty selection and an empty answer", async () => {
    const { llm } = fakeLlm(() => "  ");
    await expect(writeReport("q", [], { llm })).rejects.toThrow(/at least one source/);
    await expect(writeReport("q", [{ id: "a", title: "T", url: "https://a.org", engine: "duckduckgo", summary: "", credibility: 1, relevance: 1, markdown: "t" }], { llm })).rejects.toThrow(/empty report/);
  });
});
