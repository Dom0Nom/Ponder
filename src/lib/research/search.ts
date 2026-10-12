import { proxyHttpFor } from "../importers/http";
import type { HttpFn } from "../importers/youtube";

export const FREE_ENGINES = ["duckduckgo", "wikipedia", "arxiv", "openalex", "openstax"] as const;
export type FreeEngine = (typeof FREE_ENGINES)[number];
export const KEYED_ENGINES = ["brave", "tavily", "exa"] as const;
export type KeyedEngine = (typeof KEYED_ENGINES)[number];
export type EngineId = FreeEngine | KeyedEngine | "searxng" | "model";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  engine: EngineId;
}

export const searchKeyId = (e: KeyedEngine) => `search:${e}`;

const strip = (s: string) =>
  s
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

export function parseDuckDuckGo(html: string): SearchResult[] {
  const out: SearchResult[] = [];
  const parts = html.split(/(?=<a[^>]+class="result__a")/).slice(1);
  for (const part of parts) {
    const a = part.match(/^<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/);
    if (!a) continue;
    let url = a[1].replace(/&amp;/g, "&");
    const uddg = url.match(/[?&]uddg=([^&]+)/);
    if (uddg) url = decodeURIComponent(uddg[1]);
    if (url.startsWith("//")) url = `https:${url}`;
    if (!/^https?:/.test(url) || /duckduckgo\.com\/y\.js/.test(url)) continue;
    const snippet = part.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/)?.[1] ?? "";
    out.push({ title: strip(a[2]), url, snippet: strip(snippet), engine: "duckduckgo" });
  }
  return out;
}

export function parseArxiv(xml: string): SearchResult[] {
  const out: SearchResult[] = [];
  for (const e of xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const title = strip(e[1].match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? "");
    const id = e[1].match(/<id>([\s\S]*?)<\/id>/)?.[1]?.trim();
    const summary = strip(e[1].match(/<summary>([\s\S]*?)<\/summary>/)?.[1] ?? "");
    if (title && id) out.push({ title, url: id.replace(/^http:/, "https:"), snippet: summary.slice(0, 300), engine: "arxiv" });
  }
  return out;
}

async function json<T>(http: HttpFn, url: string): Promise<T> {
  const r = await http(url, { method: "GET", headers: { Accept: "application/json" } });
  if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
  return JSON.parse(r.body) as T;
}

type EngineFn = (http: HttpFn, q: string) => Promise<SearchResult[]>;

export const engines: Record<FreeEngine, EngineFn> = {
  duckduckgo: async (http, q) => {
    const r = await http(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`, { method: "GET" });
    if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
    return parseDuckDuckGo(r.body).slice(0, 6);
  },
  wikipedia: (http, q) => wikipediaIn("en")(http, q),
  arxiv: async (http, q) => {
    const r = await http(
      `https://export.arxiv.org/api/query?max_results=3&search_query=all:${encodeURIComponent(q)}`,
      { method: "GET" },
    );
    if (r.status >= 400) throw new Error(`HTTP ${r.status}`);
    return parseArxiv(r.body);
  },
  openalex: async (http, q) => {
    const d = await json<{ results?: { display_name: string; doi?: string | null; id: string; primary_location?: { landing_page_url?: string | null } }[] }>(
      http,
      `https://api.openalex.org/works?per_page=3&filter=is_oa:true&search=${encodeURIComponent(q)}`,
    );
    return (d.results ?? [])
      .map((w) => ({
        title: w.display_name,
        url: w.primary_location?.landing_page_url || w.doi || w.id,
        snippet: "",
        engine: "openalex" as const,
      }))
      .filter((r) => !!r.url);
  },
  openstax: async (http, q) => {
    const r = await engines.duckduckgo(http, `site:openstax.org ${q}`);
    return r.filter((x) => isHost(x.url, "openstax.org")).map((x) => ({ ...x, engine: "openstax" as const }));
  },
};

function isHost(url: string, host: string): boolean {
  try {
    const h = new URL(url).hostname.toLowerCase();
    return h === host || h.endsWith(`.${host}`);
  } catch {
    return false;
  }
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const isUrl = (u: string) => /^https?:\/\//i.test(u);

function collect(
  items: unknown,
  pick: (x: Record<string, unknown>) => { title: string; url: string; snippet: string },
  engine: EngineId,
  max = 6,
): SearchResult[] {
  if (!Array.isArray(items)) return [];
  const out: SearchResult[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const r = pick(raw as Record<string, unknown>);
    if (!isUrl(r.url)) continue;
    out.push({ title: strip(r.title) || r.url, url: r.url, snippet: strip(r.snippet).slice(0, 300), engine });
    if (out.length >= max) break;
  }
  return out;
}

export function parseSearxng(data: unknown): SearchResult[] {
  return collect((data as { results?: unknown } | null)?.results, (x) => ({ title: str(x.title), url: str(x.url), snippet: str(x.content) }), "searxng");
}

export function parseBrave(data: unknown): SearchResult[] {
  const web = (data as { web?: { results?: unknown } } | null)?.web;
  return collect(web?.results, (x) => ({ title: str(x.title), url: str(x.url), snippet: str(x.description) }), "brave");
}

export function parseTavily(data: unknown): SearchResult[] {
  return collect((data as { results?: unknown } | null)?.results, (x) => ({ title: str(x.title), url: str(x.url), snippet: str(x.content) }), "tavily");
}

export function parseExa(data: unknown): SearchResult[] {
  return collect(
    (data as { results?: unknown } | null)?.results,
    (x) => ({ title: str(x.title), url: str(x.url), snippet: str(x.summary) || str(x.text) || (Array.isArray(x.highlights) ? str(x.highlights[0]) : "") }),
    "exa",
  );
}

async function request(http: HttpFn, url: string, init: Parameters<HttpFn>[1], who: string): Promise<unknown> {
  const r = await http(url, init);
  if (r.status === 401 || r.status === 403) throw new Error(`${who} refused the request (HTTP ${r.status}). Check the key or settings.`);
  if (r.status >= 400) throw new Error(`${who}: HTTP ${r.status}`);
  try {
    return JSON.parse(r.body);
  } catch {
    throw new Error(`${who} did not return JSON`);
  }
}

export function normalizeInstanceUrl(raw: string): string {
  const t = raw.trim().replace(/\/+$/, "");
  if (!t) return "";
  return /^https?:\/\//i.test(t) ? t : `https://${t}`;
}

export function searxng(instance: string): EngineFn {
  return async (http, q) => {
    const base = normalizeInstanceUrl(instance);
    const data = await request(http, `${base}/search?q=${encodeURIComponent(q)}&format=json`, { method: "GET", headers: { Accept: "application/json" } }, "SearXNG");
    return parseSearxng(data);
  };
}

/** For the three engines below, `http` must send through the proxy with providerId `search:<engine>`. */
export const brave: EngineFn = async (http, q) =>
  parseBrave(
    await request(http, `https://api.search.brave.com/res/v1/web/search?count=6&q=${encodeURIComponent(q)}`, { method: "GET", headers: { Accept: "application/json" } }, "Brave Search"),
  );

export const tavily: EngineFn = async (http, q) =>
  parseTavily(
    await request(http, "https://api.tavily.com/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: q, max_results: 6 }) }, "Tavily"),
  );

export const exa: EngineFn = async (http, q) =>
  parseExa(
    await request(http, "https://api.exa.ai/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: q, numResults: 6 }) }, "Exa"),
  );

export interface Engine {
  id: EngineId;
  /** false: only the first query is sent, to keep slow or paid engines cheap */
  perQuery: boolean;
  run: (q: string) => Promise<SearchResult[]>;
}

export interface SearchConfig {
  free: Record<FreeEngine, boolean>;
  searxngUrl: string;
  keys: Record<KeyedEngine, boolean>;
  /** the research model's own web search, when enabled and supported */
  modelSearch?: (q: string) => Promise<SearchResult[]>;
}

export const DEFAULT_SEARCH: SearchConfig = {
  free: { duckduckgo: true, wikipedia: true, arxiv: true, openalex: true, openstax: true },
  searxngUrl: "",
  keys: { brave: false, tavily: false, exa: false },
};

const PER_QUERY: Record<FreeEngine, boolean> = { duckduckgo: true, wikipedia: false, arxiv: false, openalex: false, openstax: false };
const KEYED: Record<KeyedEngine, EngineFn> = { brave, tavily, exa };

export function buildEngines(
  cfg: SearchConfig,
  http: HttpFn,
  language = "en",
  keyedHttp: (providerId: string) => HttpFn = proxyHttpFor,
): Engine[] {
  const out: Engine[] = [];
  for (const id of FREE_ENGINES) {
    if (cfg.free[id]) out.push({ id, perQuery: PER_QUERY[id], run: (q) => engines[id](http, q) });
  }
  if (cfg.free.wikipedia && language !== "en") out.push({ id: "wikipedia", perQuery: false, run: (q) => wikipediaIn(language)(http, q) });
  if (cfg.searxngUrl.trim()) out.push({ id: "searxng", perQuery: true, run: (q) => searxng(cfg.searxngUrl)(http, q) });
  for (const id of KEYED_ENGINES) {
    if (cfg.keys[id]) {
      const h = keyedHttp(searchKeyId(id));
      out.push({ id, perQuery: true, run: (q) => KEYED[id](h, q) });
    }
  }
  if (cfg.modelSearch) out.push({ id: "model", perQuery: false, run: cfg.modelSearch });
  return out;
}

export function wikipediaIn(lang: string) {
  const host = `https://${/^[a-z]{2,3}$/.test(lang) ? lang : "en"}.wikipedia.org`;
  return async (http: HttpFn, q: string): Promise<SearchResult[]> => {
    const d = await json<{ query?: { search?: { title: string; snippet: string }[] } }>(
      http,
      `${host}/w/api.php?action=query&list=search&format=json&srlimit=3&srsearch=${encodeURIComponent(q)}`,
    );
    return (d.query?.search ?? []).map((x) => ({
      title: x.title,
      url: `${host}/wiki/${encodeURIComponent(x.title.replace(/ /g, "_"))}`,
      snippet: strip(x.snippet),
      engine: "wikipedia" as const,
    }));
  };
}

export function normalizeForDedupe(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) if (/^utm_|^ref$|^fbclid$/.test(k)) u.searchParams.delete(k);
    return `${u.hostname.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}${u.search}`.toLowerCase();
  } catch {
    return url;
  }
}
