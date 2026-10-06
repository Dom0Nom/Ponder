import { generateText } from "ai";
import { extractJson } from "../chat/json";
import type { ResolvedModel } from "../chat/llm";
import { fetchReadable } from "../importers/web";
import type { HttpFn } from "../importers/youtube";
import { engines, normalizeForDedupe, type SearchResult } from "./search";

export type ResearchStage = "planning" | "searching" | "fetching" | "ranking" | "done";

export interface FoundSource {
  id: string;
  title: string;
  url: string;
  engine: SearchResult["engine"];
  summary: string;
  credibility: number;
  relevance: number;
  markdown: string;
}

export interface ResearchDeps {
  llm: ResolvedModel;
  http: HttpFn;
  fetchPage?: typeof fetchReadable;
  onStage?: (stage: ResearchStage, detail?: string) => void;
  signal?: AbortSignal;
}

async function ask(llm: ResolvedModel, prompt: string, signal?: AbortSignal): Promise<string> {
  const r = await generateText({
    model: llm.model,
    prompt,
    abortSignal: signal,
    ...llm.options({ thinking: false }),
  });
  return r.text;
}

export async function planQueries(question: string, deps: ResearchDeps): Promise<string[]> {
  const text = await ask(
    deps.llm,
    `A learner wants study sources about: "${question}".\nWrite 3 to 5 short web search queries that would find trustworthy, free learning material (textbooks, encyclopedias, university pages, papers). Mix general and specific queries, in English unless the topic is language-specific.\nReturn JSON only: {"queries": ["...", "..."]}`,
    deps.signal,
  );
  const parsed = extractJson<{ queries?: unknown }>(text);
  const queries = Array.isArray(parsed?.queries)
    ? parsed!.queries.filter((q): q is string => typeof q === "string" && q.trim().length > 0).slice(0, 5)
    : [];
  return queries.length ? queries : [question];
}

export async function searchAll(queries: string[], deps: ResearchDeps): Promise<SearchResult[]> {
  const jobs: Promise<SearchResult[]>[] = [];
  for (const q of queries) jobs.push(engines.duckduckgo(deps.http, q));
  jobs.push(engines.wikipedia(deps.http, queries[0]), engines.arxiv(deps.http, queries[0]), engines.openalex(deps.http, queries[0]));
  const settled = await Promise.allSettled(jobs);
  const ok = settled.filter((s): s is PromiseFulfilledResult<SearchResult[]> => s.status === "fulfilled");
  if (!ok.length) throw new Error("Every search engine failed. Check your internet connection.");
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  // interleave engines so one engine can't crowd out the rest
  const lists = ok.map((s) => s.value);
  for (let i = 0; lists.some((l) => i < l.length); i++) {
    for (const l of lists) {
      const r = l[i];
      if (!r) continue;
      const key = normalizeForDedupe(r.url);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
  }
  return out.slice(0, 14);
}

interface Rating {
  i: number;
  summary?: string;
  credibility?: number;
  relevance?: number;
}

export async function rank(question: string, pages: (SearchResult & { markdown: string; title: string })[], deps: ResearchDeps): Promise<FoundSource[]> {
  const found: FoundSource[] = [];
  for (let b = 0; b < pages.length; b += 4) {
    const batch = pages.slice(b, b + 4);
    const listing = batch
      .map((p, i) => `### ${i}\nTitle: ${p.title}\nURL: ${p.url}\nText:\n${p.markdown.slice(0, 1500)}`)
      .join("\n\n");
    const text = await ask(
      deps.llm,
      `The learner's research question: "${question}".\nRate each page for a learner. credibility (0-100): how trustworthy the publisher and content are (encyclopedias, universities, textbooks, peer-reviewed papers high; content farms, forums, ads low). relevance (0-100): how well it covers the question. summary: one or two sentences on what the page teaches.\n\n${listing}\n\nReturn JSON only: [{"i": 0, "summary": "...", "credibility": 80, "relevance": 70}, ...]`,
      deps.signal,
    );
    const ratings = extractJson<Rating[]>(text) ?? [];
    batch.forEach((p, i) => {
      const r = ratings.find((x) => x?.i === i);
      found.push({
        id: normalizeForDedupe(p.url),
        title: p.title,
        url: p.url,
        engine: p.engine,
        summary: r?.summary?.trim() || p.snippet || p.markdown.slice(0, 200),
        credibility: clamp(r?.credibility, 50),
        relevance: clamp(r?.relevance, 50),
        markdown: p.markdown,
      });
    });
  }
  return found
    .filter((f) => f.relevance >= 30)
    .sort((a, b) => b.relevance * b.credibility - a.relevance * a.credibility);
}

const clamp = (n: unknown, fallback: number) =>
  typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : fallback;

export async function deepResearch(question: string, deps: ResearchDeps): Promise<FoundSource[]> {
  const fetchPage = deps.fetchPage ?? fetchReadable;
  deps.onStage?.("planning");
  const queries = await planQueries(question, deps);
  deps.onStage?.("searching", queries.join(" · "));
  const results = await searchAll(queries, deps);
  deps.onStage?.("fetching", `${results.length}`);
  const pages: (SearchResult & { markdown: string; title: string })[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: 4 }, async () => {
      while (next < results.length) {
        if (deps.signal?.aborted) return;
        const r = results[next++];
        try {
          const p = await fetchPage(r.url);
          pages.push({ ...r, url: p.url, title: p.title || r.title, markdown: p.markdown });
        } catch {
          // unreachable or unreadable pages are skipped; they never reach the review list
        }
      }
    }),
  );
  if (deps.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  if (!pages.length) return [];
  deps.onStage?.("ranking", `${pages.length}`);
  const ranked = await rank(question, pages, deps);
  deps.onStage?.("done");
  return ranked;
}
