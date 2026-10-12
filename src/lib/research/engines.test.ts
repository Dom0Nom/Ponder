import { describe, expect, it, vi } from "vitest";
import type { HttpFn } from "../importers/youtube";
import { searchAll } from "./deepResearch";
import {
  buildEngines,
  DEFAULT_SEARCH,
  engines,
  normalizeInstanceUrl,
  parseBrave,
  parseExa,
  parseSearxng,
  parseTavily,
  searxng,
  brave,
  tavily,
  exa,
  type SearchConfig,
} from "./search";

const searxJson = {
  query: "mitosis",
  results: [
    { title: "Mitosis - Khan Academy", url: "https://www.khanacademy.org/science/mitosis", content: "Cells <b>divide</b>", engine: "duckduckgo" },
    { title: "", url: "https://en.wikipedia.org/wiki/Mitosis", content: "Mitosis is a part of the cell cycle" },
    { title: "bad url", url: "javascript:alert(1)", content: "x" },
    { url: 5 },
    null,
  ],
};

const braveJson = {
  type: "search",
  web: {
    results: [
      { title: "Cell cycle", url: "https://example.edu/cell-cycle", description: "The <strong>cell cycle</strong> has phases", profile: {} },
      { title: "No url", description: "x" },
    ],
  },
};

const tavilyJson = {
  query: "mitosis",
  results: [{ title: "Mitosis", url: "https://www.britannica.com/science/mitosis", content: "Mitosis, process of nuclear division", score: 0.9 }],
};

const exaJson = {
  requestId: "r",
  results: [
    { title: "Mitosis explained", url: "https://example.org/mitosis", text: "Long text about mitosis", publishedDate: "2023-01-01" },
    { title: "Highlights only", url: "https://example.org/h", highlights: ["first highlight"] },
  ],
};

describe("engine parsers", () => {
  it("parses SearXNG JSON and drops entries without an http(s) url", () => {
    expect(parseSearxng(searxJson)).toEqual([
      { title: "Mitosis - Khan Academy", url: "https://www.khanacademy.org/science/mitosis", snippet: "Cells divide", engine: "searxng" },
      { title: "https://en.wikipedia.org/wiki/Mitosis", url: "https://en.wikipedia.org/wiki/Mitosis", snippet: "Mitosis is a part of the cell cycle", engine: "searxng" },
    ]);
    expect(parseSearxng(null)).toEqual([]);
    expect(parseSearxng({ results: "nope" })).toEqual([]);
  });

  it("parses Brave web results", () => {
    expect(parseBrave(braveJson)).toEqual([{ title: "Cell cycle", url: "https://example.edu/cell-cycle", snippet: "The cell cycle has phases", engine: "brave" }]);
    expect(parseBrave({})).toEqual([]);
  });

  it("parses Tavily results", () => {
    expect(parseTavily(tavilyJson)).toEqual([
      { title: "Mitosis", url: "https://www.britannica.com/science/mitosis", snippet: "Mitosis, process of nuclear division", engine: "tavily" },
    ]);
  });

  it("parses Exa results with text or highlights as the snippet", () => {
    expect(parseExa(exaJson).map((r) => [r.url, r.snippet])).toEqual([
      ["https://example.org/mitosis", "Long text about mitosis"],
      ["https://example.org/h", "first highlight"],
    ]);
  });

  it("normalizes SearXNG instance urls", () => {
    expect(normalizeInstanceUrl(" searx.example.org/ ")).toBe("https://searx.example.org");
    expect(normalizeInstanceUrl("http://localhost:8080//")).toBe("http://localhost:8080");
    expect(normalizeInstanceUrl("")).toBe("");
  });
});

describe("engine requests", () => {
  const ok = (body: unknown): HttpFn => vi.fn(async () => ({ status: 200, body: JSON.stringify(body) }));

  it("SearXNG calls {url}/search?q=…&format=json", async () => {
    const http = ok(searxJson);
    const r = await searxng("searx.example.org/")(http, "cell division");
    expect(http).toHaveBeenCalledWith("https://searx.example.org/search?q=cell%20division&format=json", expect.objectContaining({ method: "GET" }));
    expect(r).toHaveLength(2);
  });

  it("SearXNG explains a refused JSON format", async () => {
    const http: HttpFn = async () => ({ status: 403, body: "" });
    await expect(searxng("https://s.example")(http, "q")).rejects.toThrow(/SearXNG refused/);
  });

  it("Brave sends the query as GET and never an auth header from JS", async () => {
    const http = ok(braveJson);
    await brave(http, "cell cycle");
    const [url, init] = (http as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://api.search.brave.com/res/v1/web/search?count=6&q=cell%20cycle");
    expect(init.method).toBe("GET");
    expect(JSON.stringify(init.headers).toLowerCase()).not.toMatch(/token|authorization|x-api-key/);
  });

  it("Tavily and Exa post their JSON bodies", async () => {
    const t = ok(tavilyJson);
    await tavily(t, "mitosis");
    const [tu, ti] = (t as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(tu).toBe("https://api.tavily.com/search");
    expect(JSON.parse(ti.body)).toEqual({ query: "mitosis", max_results: 6 });
    expect(JSON.stringify(ti.headers).toLowerCase()).not.toMatch(/authorization/);

    const e = ok(exaJson);
    await exa(e, "mitosis");
    const [eu, ei] = (e as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(eu).toBe("https://api.exa.ai/search");
    expect(JSON.parse(ei.body)).toEqual({ query: "mitosis", numResults: 6 });
    expect(JSON.stringify(ei.headers).toLowerCase()).not.toMatch(/x-api-key/);
  });

  it("OpenStax is a DuckDuckGo site: query kept to openstax.org", async () => {
    const html =
      `<div><a class="result__a" href="https://openstax.org/books/biology-2e/pages/10-1-cell-division">Cell Division - Biology 2e</a><a class="result__snippet" href="x">Mitosis</a>` +
      `<div><a class="result__a" href="https://example.com/not-openstax">Other</a><a class="result__snippet" href="x">y</a>`;
    const http = vi.fn<HttpFn>(async () => ({ status: 200, body: html }));
    const r = await engines.openstax(http, "mitosis");
    expect(decodeURIComponent(http.mock.calls[0][0])).toContain("q=site:openstax.org mitosis");
    expect(r).toEqual([
      { title: "Cell Division - Biology 2e", url: "https://openstax.org/books/biology-2e/pages/10-1-cell-division", snippet: "Mitosis", engine: "openstax" },
    ]);
  });
});

describe("buildEngines and searchAll", () => {
  const only = (over: Partial<SearchConfig>): SearchConfig => ({
    ...DEFAULT_SEARCH,
    free: { duckduckgo: false, wikipedia: false, arxiv: false, openalex: false, openstax: false },
    ...over,
  });

  it("builds only what is enabled", () => {
    expect(buildEngines(DEFAULT_SEARCH, vi.fn()).map((e) => e.id)).toEqual(["duckduckgo", "wikipedia", "arxiv", "openalex", "openstax"]);
    expect(buildEngines(only({}), vi.fn())).toEqual([]);
    const cfg = only({ searxngUrl: "https://s.example", keys: { brave: true, tavily: false, exa: true }, modelSearch: async () => [] });
    expect(buildEngines(cfg, vi.fn(), "en", () => vi.fn()).map((e) => e.id)).toEqual(["searxng", "brave", "exa", "model"]);
    expect(buildEngines({ ...DEFAULT_SEARCH, free: { ...DEFAULT_SEARCH.free, duckduckgo: false } }, vi.fn(), "de").map((e) => e.id)).toContain("wikipedia");
  });

  it("keyed engines go through a provider-bound http fn for their own id", async () => {
    const bound: string[] = [];
    const keyedHttp = (id: string): HttpFn => {
      bound.push(id);
      return async () => ({ status: 200, body: JSON.stringify(braveJson) });
    };
    const list = buildEngines(only({ keys: { brave: true, tavily: false, exa: false } }), vi.fn(), "en", keyedHttp);
    expect(bound).toEqual(["search:brave"]);
    expect((await list[0].run("q")).map((r) => r.engine)).toEqual(["brave"]);
  });

  it("one failing engine never breaks the run", async () => {
    const http: HttpFn = async (url) => {
      if (url.includes("searx.bad")) throw new Error("connection refused");
      if (url.includes("duckduckgo")) return { status: 200, body: `<div><a class="result__a" href="https://example.org/a">A</a><a class="result__snippet" href="x">s</a>` };
      return { status: 500, body: "" };
    };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cfg = { ...DEFAULT_SEARCH, searxngUrl: "https://searx.bad" };
    const r = await searchAll(["q"], { http, llm: {} as never, search: cfg });
    expect(r.map((x) => x.url)).toEqual(["https://example.org/a"]);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("fails only when every engine fails, and says so when none is on", async () => {
    const down: HttpFn = async () => ({ status: 500, body: "" });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(searchAll(["q"], { http: down, llm: {} as never })).rejects.toThrow(/Every search engine failed/);
    await expect(searchAll(["q"], { http: down, llm: {} as never, search: only({}) })).rejects.toThrow(/No search engine is turned on/);
    warn.mockRestore();
  });

  it("sends every query to per-query engines and only the first to the others", async () => {
    const urls: string[] = [];
    const http: HttpFn = async (url) => {
      urls.push(url);
      return { status: 200, body: url.includes("duckduckgo") ? "" : "{}" };
    };
    await searchAll(["one", "two"], { http, llm: {} as never, search: { ...DEFAULT_SEARCH, free: { ...DEFAULT_SEARCH.free, openstax: false } } });
    const ddg = urls.filter((u) => u.includes("duckduckgo")).map((u) => new URL(u).searchParams.get("q"));
    expect(ddg.sort()).toEqual(["one", "two"]);
    expect(urls.filter((u) => u.includes("wikipedia"))).toHaveLength(1);
    expect(urls.filter((u) => u.includes("openalex"))).toHaveLength(1);
  });

  it("drops results already known before applying the result cap", async () => {
    const hit = (n: number) => `<div><a class="result__a" href="https://example.org/${n}">T${n}</a><a class="result__snippet" href="x">s</a>`;
    const http: HttpFn = async () => ({ status: 200, body: [1, 2, 3, 4].map(hit).join("") });
    const cfg = { ...DEFAULT_SEARCH, free: { ...only({}).free, duckduckgo: true } };
    const skip = new Set(["example.org/1", "example.org/2"]);
    const r = await searchAll(["q"], { http, llm: {} as never, search: cfg }, "en", skip);
    expect(r.map((x) => x.url)).toEqual(["https://example.org/3", "https://example.org/4"]);
  });
});
