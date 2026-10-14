import { api } from "../ipc";
import type { Citation, RangeRequest, SearchHit, Source, SourceOutline, SourceRange } from "../types";
import type { SectionTarget } from "./plan";
import { countTokens, truncateToTokens } from "./tokens";

/** One numbered piece of source text the model can cite. */
export interface ContextPassage {
  n: number;
  sourceId: string;
  sourceTitle: string;
  chunkId: number;
  start: number;
  end: number;
  page: number | null;
  pageTo: number | null;
  /** section title or what was asked for ("Chapter 5") */
  label: string | null;
  text: string;
  tokens: number;
  why: "section" | "search" | "full" | "tool";
}

const RRF_K = 60;
/** Text longer than this is split into separately numbered blocks, so citations stay precise. */
const BLOCK_CHARS = 4_000;
const AVG_CHUNK_TOKENS = 200;

/** Reciprocal rank fusion over several result lists; a chunk found by several queries ranks higher. */
export function fuse(lists: SearchHit[][]): { hit: SearchHit; score: number }[] {
  const by = new Map<number, { hit: SearchHit; score: number }>();
  for (const list of lists) {
    list.forEach((h, rank) => {
      const cur = by.get(h.chunkId);
      const add = 1 / (RRF_K + rank + 1);
      if (cur) cur.score += add;
      else by.set(h.chunkId, { hit: h, score: add });
    });
  }
  return [...by.values()].sort((a, b) => b.score - a.score || a.hit.chunkId - b.hit.chunkId);
}

interface Range {
  sourceId: string;
  from: number;
  to: number;
  score: number;
  label: string | null;
  all?: boolean;
}

/** Deepest outline entry that contains `ord`. */
export function sectionAt(outline: SourceOutline | undefined, ord: number) {
  const hits = outline?.entries.filter((e) => e.ordFrom <= ord && e.ordTo >= ord) ?? [];
  return hits.sort((a, b) => b.level - a.level || a.ordTo - a.ordFrom - (b.ordTo - b.ordFrom))[0];
}

export interface ExpandOptions {
  /** tokens available for passages */
  budget: number;
  sources: Map<string, Source>;
  outlines: Map<string, SourceOutline>;
}

/**
 * Turns ranked hits into source ranges: a small source whole, a hit's section when the section
 * is short, else the hit with its neighbours. Overlapping ranges in a source merge.
 */
export function expandHits(ranked: { hit: SearchHit; score: number }[], { budget, sources, outlines }: ExpandOptions): Range[] {
  const radius = budget > 60_000 ? 2 : 1;
  const smallSource = Math.min(4_000, budget * 0.12);
  const section = Math.min(6_000, budget * 0.15);
  const out: Range[] = [];
  let est = 0;
  for (const { hit, score } of ranked) {
    if (est >= budget * 1.2) break;
    const ord = hit.ord ?? 0;
    const src = sources.get(hit.sourceId);
    let r: Range;
    if (src && src.charCount / 4 <= smallSource) r = { sourceId: hit.sourceId, from: 0, to: Math.max(0, src.chunkCount - 1), score, label: null, all: true };
    else {
      const sec = sectionAt(outlines.get(hit.sourceId), ord);
      if (sec && (sec.ordTo - sec.ordFrom + 1) * AVG_CHUNK_TOKENS <= section) r = { sourceId: hit.sourceId, from: sec.ordFrom, to: sec.ordTo, score, label: sec.title };
      else r = { sourceId: hit.sourceId, from: Math.max(0, ord - radius), to: ord + radius, score, label: sec?.title ?? hit.heading ?? null };
    }
    const same = out.find((x) => x.sourceId === r.sourceId && (x.all || (r.from <= x.to + 1 && r.to >= x.from - 1)));
    if (same) {
      if (!same.all) {
        est -= (same.to - same.from + 1) * AVG_CHUNK_TOKENS;
        same.from = Math.min(same.from, r.from);
        same.to = Math.max(same.to, r.to);
        est += (same.to - same.from + 1) * AVG_CHUNK_TOKENS;
      }
      same.score += score / 4;
      continue;
    }
    out.push(r);
    est += r.all ? (src?.charCount ?? 0) / 4 : (r.to - r.from + 1) * AVG_CHUNK_TOKENS;
  }
  return out;
}

function pageAt(r: SourceRange, offset: number): number | null {
  let page = r.pageFrom;
  for (const [p, o] of r.pageStarts ?? []) {
    if (o <= offset) page = p;
    else break;
  }
  return page;
}

/** Splits a range's text into blocks of about BLOCK_CHARS at paragraph breaks. */
export function blocks(r: SourceRange): { text: string; start: number; end: number; page: number | null; pageTo: number | null }[] {
  const out = [];
  let i = 0;
  const t = r.text;
  while (i < t.length) {
    let j = Math.min(t.length, i + BLOCK_CHARS);
    if (j < t.length) {
      const para = t.lastIndexOf("\n", j);
      if (para > i + BLOCK_CHARS / 2) j = para + 1;
    }
    const start = r.start + i;
    const end = r.start + j;
    out.push({ text: t.slice(i, j).trim(), start, end, page: pageAt(r, start), pageTo: j >= t.length ? (r.pageTo ?? pageAt(r, end - 1)) : pageAt(r, end - 1) });
    i = j;
  }
  return out.filter((b) => b.text);
}

export interface Numbered {
  passages: ContextPassage[];
  tokens: number;
  truncated: string[];
}

/** Adds ranges in order as numbered passages until `budget` runs out; the last one may be cut. */
export function numberRanges(
  ranges: { range: SourceRange; label: string | null; why: ContextPassage["why"] }[],
  budget: number,
  startAt = 1,
): Numbered {
  const passages: ContextPassage[] = [];
  const truncated: string[] = [];
  let tokens = 0;
  let n = startAt;
  outer: for (const { range, label, why } of ranges) {
    for (const b of blocks(range)) {
      let text = b.text;
      let t = countTokens(text) + 20;
      if (tokens + t > budget) {
        const left = budget - tokens - 40;
        if (left < 150) {
          truncated.push(range.sourceTitle);
          break outer;
        }
        text = `${truncateToTokens(text, left).text}\n[truncated to fit the context]`;
        t = countTokens(text) + 20;
        truncated.push(range.sourceTitle);
      }
      passages.push({
        n: n++,
        sourceId: range.sourceId,
        sourceTitle: range.sourceTitle,
        chunkId: range.chunkId ?? 0,
        start: b.start,
        end: b.end,
        page: b.page,
        pageTo: b.pageTo,
        label,
        text,
        tokens: t,
        why,
      });
      tokens += t;
      if (tokens >= budget) break outer;
    }
    if (range.truncated) truncated.push(range.sourceTitle);
  }
  return { passages, tokens, truncated: [...new Set(truncated)] };
}

async function read(reqs: RangeRequest[]): Promise<(SourceRange | null)[]> {
  if (!reqs.length) return [];
  const res = await api.readSourceRanges(reqs);
  return res.map((r) => r.range);
}

export interface GatherInput {
  spaceId: string;
  /** standalone query first, then sub-queries */
  queries: string[];
  sections: SectionTarget[];
  /** sources that are searched (auto mode, enabled, ready) */
  searchable: Source[];
  outlines: Map<string, SourceOutline>;
  budget: number;
  /** fill with whole top-ranked sources instead of passages */
  large: boolean;
  /** citation numbers start here */
  startAt?: number;
}

export interface Gathered extends Numbered {
  hits: number;
  /** sources that went in whole */
  whole: string[];
}

/** Sections asked for, then search results expanded, as numbered passages within `budget`. */
export async function gatherPassages(g: GatherInput): Promise<Gathered> {
  const sources = new Map(g.searchable.map((s) => [s.id, s]));
  const ids = g.searchable.map((s) => s.id);
  if (!ids.length || g.budget < 200) return { passages: [], tokens: 0, truncated: [], hits: 0, whole: [] };
  const perQuery = Math.min(200, Math.max(12, Math.round(g.budget / 1500)));
  const [lists, sectionRanges] = await Promise.all([
    g.queries.length ? api.searchManyChunks(g.spaceId, g.queries, perQuery, ids) : Promise.resolve([] as SearchHit[][]),
    read(
      g.sections
        .filter((s) => sources.has(s.sourceId))
        .map((s) => ({ sourceId: s.sourceId, unit: s.unit, from: s.from, to: s.to, maxChars: Math.round(g.budget * 3) })),
    ),
  ]);
  const ranked = fuse(lists);
  const picked: { range: SourceRange; label: string | null; why: ContextPassage["why"] }[] = [];
  sectionRanges.forEach((r, i) => r && picked.push({ range: r, label: g.sections[i].label, why: "section" }));

  const sectionBudget = picked.reduce((n, p) => n + countTokens(p.range.text), 0);
  let left = Math.max(0, g.budget - Math.min(sectionBudget, g.budget * 0.7));
  const whole: string[] = [];
  if (g.large && left > 0) {
    const bySource = new Map<string, number>();
    for (const { hit, score } of ranked) bySource.set(hit.sourceId, (bySource.get(hit.sourceId) ?? 0) + score);
    const top = [...bySource.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => sources.get(id)!).filter(Boolean);
    const take: Source[] = [];
    let est = 0;
    for (const s of top) {
      const t = s.charCount / 3.6;
      if (est + t > left * 0.7) continue;
      take.push(s);
      est += t;
    }
    const full = await read(take.map((s) => ({ sourceId: s.id, unit: "all" as const })));
    full.forEach((r) => {
      if (!r) return;
      picked.push({ range: r, label: null, why: "full" });
      whole.push(r.sourceId);
    });
    left -= est;
  }
  const rest = ranked.filter(({ hit }) => !whole.includes(hit.sourceId));
  const ranges = expandHits(rest, { budget: Math.max(0, left), sources, outlines: g.outlines });
  const got = await read(
    ranges.map((r) => (r.all ? { sourceId: r.sourceId, unit: "all" as const } : { sourceId: r.sourceId, unit: "chunk" as const, from: r.from, to: r.to })),
  );
  got.forEach((r, i) => r && picked.push({ range: r, label: ranges[i].label, why: "search" }));
  const numbered = numberRanges(dedupe(picked), g.budget, g.startAt ?? 1);
  return { ...numbered, hits: ranked.length, whole };
}

/** Drops ranges contained in an earlier one from the same source. */
function dedupe<T extends { range: SourceRange }>(list: T[]): T[] {
  const out: T[] = [];
  for (const x of list) {
    if (out.some((y) => y.range.sourceId === x.range.sourceId && y.range.start <= x.range.start && y.range.end >= x.range.end)) continue;
    out.push(x);
  }
  return out;
}

export function passageCitations(passages: ContextPassage[]): Citation[] {
  return passages.map((p) => ({
    n: p.n,
    chunkId: p.chunkId,
    sourceId: p.sourceId,
    sourceTitle: p.sourceTitle,
    start: p.start,
    end: p.end,
    page: p.page,
    snippet: p.text.length > 280 ? `${p.text.slice(0, 277)}…` : p.text,
    text: p.text,
  }));
}

export function passageHeader(p: ContextPassage): string {
  const pages = p.page != null ? (p.pageTo != null && p.pageTo !== p.page ? `, p. ${p.page}–${p.pageTo}` : `, p. ${p.page}`) : "";
  return `[${p.n}] (${p.sourceTitle}${pages}${p.label ? ` · ${p.label}` : ""})`;
}

export const renderPassages = (ps: ContextPassage[]) => ps.map((p) => `${passageHeader(p)}\n${p.text}`).join("\n\n");
