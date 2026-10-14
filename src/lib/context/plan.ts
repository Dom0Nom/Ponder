import { generateText } from "ai";
import type { ResolvedModel } from "../chat/llm";
import { extractJson } from "../chat/json";
import type { Source, SourceOutline } from "../types";
import type { HistoryMessage } from "./history";

export interface SearchPlan {
  /** the latest message rewritten to stand on its own */
  query: string;
  /** extra searches for broad or multi-part questions, at most 5 */
  searches: string[];
}

export const PLAN_SYSTEM =
  "You turn a learner's latest chat message into search queries over their study sources. Reply with JSON only.";

export function planPrompt(recent: HistoryMessage[], latest: string): string {
  const convo = recent
    .map((m) => `${m.role === "user" ? "Learner" : "Tutor"}: ${m.content.length > 600 ? `${m.content.slice(0, 600)}…` : m.content}`)
    .join("\n");
  return [
    convo ? `Earlier in the conversation:\n${convo}\n` : "",
    `Latest message: ${latest}`,
    "",
    'Return {"query": string, "searches": string[]}.',
    '- "query": the latest message rewritten as a standalone search query. Replace "it", "that", "this chapter", "the second one" etc. with what they refer to in the conversation. Keep names, numbers, chapter and page references. Same language as the message.',
    '- "searches": 0 to 5 more queries, only when the message is broad or has several parts (a comparison, "summarize", "all the…", a multi-step problem). Each covers one part or angle, using the words a textbook would use. Use [] for a narrow question.',
    "- If the latest message is small talk or an instruction without content (\"thanks\", \"shorter please\"), repeat the previous topic as the query.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function parsePlan(text: string, fallback: string): SearchPlan {
  const j = extractJson<{ query?: unknown; searches?: unknown }>(text);
  const query = typeof j?.query === "string" && j.query.trim() ? j.query.trim() : fallback;
  const searches = Array.isArray(j?.searches)
    ? j.searches
        .filter((x): x is string => typeof x === "string" && x.trim().length > 1)
        .map((x) => x.trim())
        .filter((x, i, a) => x.toLowerCase() !== query.toLowerCase() && a.indexOf(x) === i)
        .slice(0, 5)
    : [];
  return { query, searches };
}

const cache = new Map<string, SearchPlan>();
const CACHE_MAX = 200;

/** Standalone query + sub-queries from a helper model; cached per conversation state. */
export async function planSearch(llm: ResolvedModel, recent: HistoryMessage[], latest: string, signal?: AbortSignal): Promise<SearchPlan> {
  const key = `${llm.provider.id}|${llm.modelId}|${recent.map((m) => m.content.slice(0, 200)).join("|")}|${latest}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const r = await generateText({
    model: llm.model,
    ...llm.options({ thinking: false }),
    system: PLAN_SYSTEM,
    prompt: planPrompt(recent.slice(-6), latest),
    temperature: 0,
    maxOutputTokens: 400,
    abortSignal: signal,
  });
  const plan = parsePlan(r.text.replace(/<think>[\s\S]*?<\/think>/g, ""), latest);
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(key, plan);
  return plan;
}

/** A chapter/section/page reference in the learner's words. */
export interface SectionRef {
  kind: "chapter" | "section" | "page";
  from: number;
  to: number;
  /** "5.2" for sections */
  label?: string;
}

const CHAPTER = /\b(?:chapter|chap\.?|ch\.?|kapitel|kap\.?|unit|einheit|lesson|lektion|module|modul|part|teil)\s*(\d{1,3})(?:\s*(?:-|–|to|bis|and|und)\s*(\d{1,3}))?/gi;
const SECTION = /\b(?:section|abschnitt|§)?\s*(\d{1,2})\.(\d{1,2})\b/g;
const PAGE = /\b(?:pages?|pp?\.|seiten?|s\.)\s*(\d{1,4})(?:\s*(?:-|–|to|bis)\s*(\d{1,4}))?/gi;

export function sectionRefs(text: string): SectionRef[] {
  const out: SectionRef[] = [];
  for (const m of text.matchAll(CHAPTER)) out.push({ kind: "chapter", from: +m[1], to: +(m[2] ?? m[1]) });
  for (const m of text.matchAll(PAGE)) out.push({ kind: "page", from: +m[1], to: +(m[2] ?? m[1]) });
  for (const m of text.matchAll(SECTION)) {
    if (/^\s*(%|kg|g\b|m\b|cm|mm|km|s\b|€|\$|°)/.test(text.slice((m.index ?? 0) + m[0].length))) continue;
    out.push({ kind: "section", from: +m[1], to: +m[1], label: `${+m[1]}.${+m[2]}` });
  }
  return out;
}

const words = (t: string) =>
  t
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2 || /^\d+$/.test(w));

/** Sources the text names: every significant word of a short title, or most of a long one. */
export function namedSources(text: string, sources: Source[]): Source[] {
  const said = new Set(words(text));
  const stop = new Set(["the", "and", "for", "pdf", "with", "der", "die", "das", "und", "openstax", "rice", "university", "edition"]);
  return sources
    .map((s) => {
      // "Volume 1" vs "Volume 2" differ only by the number, so numbers count; "2e" (edition) doesn't
      const tw = [...new Set(words(s.title.replace(/\.[a-z]{2,4}$/i, "")))].filter((w) => !stop.has(w) && !/^\d+e$/.test(w));
      const hits = tw.filter((w) => said.has(w)).length;
      return { s, score: tw.length ? hits / tw.length : 0, hits };
    })
    .filter((x) => x.hits >= 1 && x.score >= 0.6)
    .sort((a, b) => b.score - a.score || b.hits - a.hits)
    .map((x) => x.s);
}

export interface SectionTarget {
  sourceId: string;
  unit: "chunk" | "page";
  from: number;
  to: number;
  label: string;
}

/**
 * Chapter, section or page ranges the message asks for, resolved against outlines. Only sources
 * named in the text are used, or the one source when the space has a single one with such a section.
 */
export function resolveSections(text: string, sources: Source[], outlines: Map<string, SourceOutline>): SectionTarget[] {
  const refs = sectionRefs(text);
  if (!refs.length) return [];
  const named = namedSources(text, sources);
  const out: SectionTarget[] = [];
  for (const ref of refs) {
    if (ref.kind === "page") {
      const src = named[0] ?? (sources.length === 1 ? sources[0] : undefined);
      if (src) out.push({ sourceId: src.id, unit: "page", from: ref.from, to: ref.to, label: `p. ${ref.from}${ref.to !== ref.from ? `–${ref.to}` : ""}` });
      continue;
    }
    const match = (o: SourceOutline) =>
      o.entries.filter((e) => {
        if (ref.kind === "section") return e.title.startsWith(`${ref.label} `);
        const n = /(?:chapter|kapitel|unit|part|teil|lesson|module)\s+(\d+)/i.exec(e.title)?.[1] ?? (e.level === 1 ? /^(\d+)[\s.:]/.exec(e.title)?.[1] : undefined);
        return n != null && +n >= ref.from && +n <= ref.to;
      });
    const pool = named.length ? named : sources;
    const found = pool.map((s) => ({ s, entries: outlines.get(s.id) ? match(outlines.get(s.id)!) : [] })).filter((x) => x.entries.length);
    if (!named.length && found.length !== 1) continue;
    const pick = found[0];
    if (!pick) continue;
    const first = pick.entries[0];
    const last = pick.entries[pick.entries.length - 1];
    out.push({ sourceId: pick.s.id, unit: "chunk", from: first.ordFrom, to: last.ordTo, label: pick.entries.length === 1 ? first.title : `${first.title} – ${last.title}` });
  }
  return out;
}
