import { generateText } from "ai";
import { extractJson } from "../chat/json";
import type { ResolvedModel } from "../chat/llm";
import { fetchReadable } from "../importers/web";
import type { HttpFn } from "../importers/youtube";
import { DEFAULT_RESEARCH_SYSTEM_PROMPT } from "./prompts";
import { engines, normalizeForDedupe, wikipediaIn, type SearchResult } from "./search";

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
  systemPrompt?: string;
  http: HttpFn;
  fetchPage?: typeof fetchReadable;
  onStage?: (stage: ResearchStage, detail?: string) => void;
  signal?: AbortSignal;
}

async function ask(deps: ResearchDeps, prompt: string, signal?: AbortSignal): Promise<string> {
  const { llm } = deps;
  const r = await generateText({
    model: llm.model,
    system: deps.systemPrompt?.trim() || DEFAULT_RESEARCH_SYSTEM_PROMPT,
    prompt,
    abortSignal: signal,
    ...llm.options({ thinking: false }),
  });
  return r.text;
}

export interface Plan {
  queries: string[];
  /** ISO 639-1 language of the learner's question */
  language: string;
}

export async function planQueries(question: string, deps: ResearchDeps): Promise<Plan> {
  const text = await ask(
    deps,
    `A learner wants study sources about: "${question}".\nWrite 3 to 5 short web search queries that would find trustworthy, free learning material. If the question isn't in English, write about half the queries in the learner's language and half in English.\nAlso give the ISO 639-1 code of the language the question is written in.\nReturn JSON only: {"language": "en", "queries": ["...", "..."]}`,
    deps.signal,
  );
  const parsed = extractJson<{ queries?: unknown; language?: unknown }>(text);
  const queries = Array.isArray(parsed?.queries)
    ? parsed!.queries.filter((q): q is string => typeof q === "string" && q.trim().length > 0).slice(0, 5)
    : [];
  const language = typeof parsed?.language === "string" && /^[a-z]{2}$/.test(parsed.language) ? parsed.language : "en";
  return { queries: queries.length ? queries : [question], language };
}

export async function searchAll(queries: string[], deps: ResearchDeps, language = "en"): Promise<SearchResult[]> {
  const jobs: Promise<SearchResult[]>[] = [];
  for (const q of queries) jobs.push(engines.duckduckgo(deps.http, q));
  jobs.push(engines.wikipedia(deps.http, queries[0]), engines.arxiv(deps.http, queries[0]), engines.openalex(deps.http, queries[0]));
  if (language !== "en") jobs.push(wikipediaIn(language)(deps.http, queries[0]));
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
  about?: string;
  answers?: boolean;
  summary?: string;
  credibility?: number;
  relevance?: number;
}

export const MIN_RELEVANCE = 55;

type Page = SearchResult & { markdown: string; title: string };

export function rankPrompt(question: string, batch: Page[]): string {
  const listing = batch
    .map((p, i) => `### ${i}\nTitle: ${p.title}\nURL: ${p.url}\nText:\n${p.markdown.slice(0, 1500)}`)
    .join("\n\n");
  return `The learner's question: "${question}".
Judge each page against this exact question, using the page text only (ignore which search query found it).
- about: a few words naming what the page is actually about.
- answers: true only if someone asking the question would learn the answer, or a direct building block of it, from this page.
- relevance (0-100): 90-100 directly teaches what the question asks; 60-85 covers the question's topic well but less directly; 30-55 same broad field, different topic; 0-25 a different subject that only shares words (e.g. a physics paper for a biology question, or a paper using the same term in another sense). A rigorous paper on a different topic is still low relevance.
- credibility (0-100): trustworthiness of publisher and content (encyclopedias, universities, textbooks, peer-reviewed papers high; content farms, forums, ads low).
- summary: one or two sentences on what the page teaches.

${listing}

Return JSON only: [{"i": 0, "about": "...", "answers": true, "relevance": 70, "credibility": 80, "summary": "..."}, ...]`;
}

export function applyRatings(batch: Page[], ratings: Rating[]): FoundSource[] {
  return batch.map((p, i) => {
    const r = ratings.find((x) => x?.i === i);
    let relevance = clamp(r?.relevance, 0);
    if (r?.answers === false) relevance = Math.min(relevance, MIN_RELEVANCE - 1);
    return {
      id: normalizeForDedupe(p.url),
      title: p.title,
      url: p.url,
      engine: p.engine,
      summary: r?.summary?.trim() || p.snippet || p.markdown.slice(0, 200),
      credibility: clamp(r?.credibility, 50),
      relevance,
      markdown: p.markdown,
    };
  });
}

export function filterAndSort(found: FoundSource[]): FoundSource[] {
  const score = (f: FoundSource) => 0.7 * f.relevance + 0.3 * f.credibility;
  return found.filter((f) => f.relevance >= MIN_RELEVANCE).sort((a, b) => score(b) - score(a));
}

export async function rank(question: string, pages: Page[], deps: ResearchDeps): Promise<FoundSource[]> {
  const found: FoundSource[] = [];
  for (let b = 0; b < pages.length; b += 4) {
    const batch = pages.slice(b, b + 4);
    const text = await ask(deps, rankPrompt(question, batch), deps.signal);
    found.push(...applyRatings(batch, extractJson<Rating[]>(text) ?? []));
  }
  return filterAndSort(found);
}

const clamp = (n: unknown, fallback: number) =>
  typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : fallback;

export async function deepResearch(question: string, deps: ResearchDeps): Promise<FoundSource[]> {
  const fetchPage = deps.fetchPage ?? fetchReadable;
  deps.onStage?.("planning");
  const { queries, language } = await planQueries(question, deps);
  deps.onStage?.("searching", queries.join(" · "));
  const results = await searchAll(queries, deps, language);
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
