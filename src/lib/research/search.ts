import type { HttpFn } from "../importers/youtube";

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  engine: "duckduckgo" | "wikipedia" | "arxiv" | "openalex";
}

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

export const engines: Record<SearchResult["engine"], (http: HttpFn, q: string) => Promise<SearchResult[]>> = {
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
};

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
