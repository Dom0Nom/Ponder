import { jsonSchema, tool, type ToolSet } from "ai";
import { api } from "../ipc";
import type { SourceOutline, SourceRange } from "../types";
import type { Handles } from "./sourceMap";
import { fuse, numberRanges, renderPassages, sectionAt, type ContextPassage } from "./retrieve";

/** Passages numbered so far in a turn; tools append to it so their reads can be cited. */
export class PassageBook {
  passages: ContextPassage[];
  readTokens = 0;
  constructor(initial: ContextPassage[]) {
    this.passages = [...initial];
  }
  get next() {
    return (this.passages[this.passages.length - 1]?.n ?? 0) + 1;
  }
  add(ps: ContextPassage[]) {
    this.passages.push(...ps);
    this.readTokens += ps.reduce((n, p) => n + p.tokens, 0);
  }
}

export interface ToolEnv {
  spaceId: string;
  handles: Handles;
  outlines: Map<string, SourceOutline>;
  book: PassageBook;
  /** tokens the tools may add in this turn */
  readBudget: number;
  /** "Reading <title>, pages 40–52" for the status row */
  onActivity: (label: string) => void;
  labels: {
    searching: (q: string) => string;
    reading: (title: string, where: string) => string;
    outline: (title: string) => string;
    listing: string;
  };
}

const SPAN = /^\s*(\d+)\s*(?:[-–]\s*(\d+))?\s*$/;

export function parseSpan(s: string | undefined): [number, number] | null {
  const m = s ? SPAN.exec(s) : null;
  if (!m) return null;
  const a = +m[1];
  const b = m[2] != null ? +m[2] : a;
  return [Math.min(a, b), Math.max(a, b)];
}

function left(env: ToolEnv) {
  return env.readBudget - env.book.readTokens;
}

const budgetNote = "The reading budget for this answer is used up. Answer with what you have and say what you couldn't read.";

function cite(env: ToolEnv, ranges: { range: SourceRange; label: string | null }[], cap: number): string {
  const { passages, truncated } = numberRanges(
    ranges.map((r) => ({ ...r, why: "tool" as const })),
    Math.min(cap, left(env)),
    env.book.next,
  );
  env.book.add(passages);
  if (!passages.length) return budgetNote;
  return `${renderPassages(passages)}${truncated.length ? "\n\n[Cut to fit the reading budget; ask for a smaller range to read the rest.]" : ""}\n\nCite these passages by their numbers.`;
}

/** `search_sources`, `read_source`, `get_outline` and `list_sources` for models that can call tools. */
export function sourceTools(env: ToolEnv): ToolSet {
  const source = (h: string) => env.handles.byHandle.get(h.trim().toUpperCase());
  return {
    search_sources: tool({
      description: "Search the learner's sources. Returns numbered passages you can cite. Use for facts the passages you already have don't cover.",
      inputSchema: jsonSchema<{ query: string; source?: string }>({
        type: "object",
        properties: {
          query: { type: "string", description: "What to look for, in the words a textbook would use" },
          source: { type: "string", description: "Optional source handle like S3 to search only that source" },
        },
        required: ["query"],
      }),
      execute: async ({ query, source: h }) => {
        if (left(env) < 300) return budgetNote;
        env.onActivity(env.labels.searching(query));
        const only = h ? source(h) : undefined;
        const ids = only ? [only.id] : [...env.handles.byHandle.values()].map((s) => s.id);
        const lists = await api.searchManyChunks(env.spaceId, [query], 8, ids);
        const ranked = fuse(lists).slice(0, 6);
        const seen = new Set(env.book.passages.map((p) => `${p.sourceId}:${p.start}`));
        const reqs = ranked
          .map(({ hit }) => ({ sourceId: hit.sourceId, unit: "chunk" as const, from: Math.max(0, (hit.ord ?? 0) - 1), to: (hit.ord ?? 0) + 1 }))
          .filter((r) => !seen.has(`${r.sourceId}:${r.from}`));
        const res = await api.readSourceRanges(reqs);
        const ranges = res.flatMap((r, i) => (r.range ? [{ range: r.range, label: sectionAt(env.outlines.get(reqs[i].sourceId), reqs[i].from + 1)?.title ?? null }] : []));
        if (!ranges.length) return "Nothing in the sources matched that search.";
        return cite(env, ranges, 6_000);
      },
    }),
    read_source: tool({
      description:
        "Read part of one source in full: a page range (pages \"40-52\"), an outline section (section title from get_outline), or chunk numbers. Returns numbered passages you can cite. Read what you need, not whole books.",
      inputSchema: jsonSchema<{ source: string; pages?: string; section?: string; chunks?: string }>({
        type: "object",
        properties: {
          source: { type: "string", description: "Source handle like S3" },
          pages: { type: "string", description: 'Page range like "40-52"' },
          section: { type: "string", description: "Title (or its start) of an outline entry" },
          chunks: { type: "string", description: 'Chunk range like "10-20"' },
        },
        required: ["source"],
      }),
      execute: async ({ source: h, pages, section, chunks }) => {
        const src = source(h);
        if (!src) return `Unknown source ${h}. Use list_sources to see the handles.`;
        if (left(env) < 300) return budgetNote;
        let req: { unit: "page" | "chunk"; from: number; to: number } | null = null;
        let where = "";
        const p = parseSpan(pages);
        const c = parseSpan(chunks);
        if (p) {
          req = { unit: "page", from: p[0], to: p[1] };
          where = `p. ${p[0]}${p[1] !== p[0] ? `–${p[1]}` : ""}`;
        } else if (section) {
          const want = section.trim().toLowerCase();
          const e = env.outlines.get(src.id)?.entries.find((x) => x.title.toLowerCase().startsWith(want) || x.title.toLowerCase().includes(want));
          if (!e) return `No section "${section}" in ${h}. Use get_outline to see its sections.`;
          req = { unit: "chunk", from: e.ordFrom, to: e.ordTo };
          where = e.title;
        } else if (c) {
          req = { unit: "chunk", from: c[0], to: c[1] };
          where = `chunks ${c[0]}–${c[1]}`;
        } else return "Give pages, a section or chunks to read.";
        env.onActivity(env.labels.reading(src.title, where));
        const [r] = await api.readSourceRanges([{ sourceId: src.id, ...req, maxChars: Math.max(2_000, left(env) * 4) }]);
        if (!r?.range) return r?.error ?? "Couldn't read that part.";
        return cite(env, [{ range: r.range, label: where }], left(env));
      },
    }),
    get_outline: tool({
      description: "Table of contents of one source with page ranges, to find which part to read.",
      inputSchema: jsonSchema<{ source: string }>({
        type: "object",
        properties: { source: { type: "string", description: "Source handle like S3" } },
        required: ["source"],
      }),
      execute: async ({ source: h }) => {
        const src = source(h);
        if (!src) return `Unknown source ${h}.`;
        env.onActivity(env.labels.outline(src.title));
        const o = env.outlines.get(src.id);
        if (!o?.entries.length) return `${h} has no outline. Search it with search_sources (source: "${h}") or read pages.`;
        return o.entries
          .slice(0, 300)
          .map((e) => `${"  ".repeat(e.level - 1)}- ${e.title}${e.pageFrom != null ? ` (p. ${e.pageFrom}${e.pageTo != null && e.pageTo !== e.pageFrom ? `–${e.pageTo}` : ""})` : ` (chunks ${e.ordFrom}–${e.ordTo})`}`)
          .join("\n");
      },
    }),
    list_sources: tool({
      description: "List the learner's sources with handles, optionally filtered by words in the title or summary.",
      inputSchema: jsonSchema<{ filter?: string }>({
        type: "object",
        properties: { filter: { type: "string" } },
      }),
      execute: async ({ filter }) => {
        env.onActivity(env.labels.listing);
        const words = (filter ?? "").toLowerCase().split(/\s+/).filter(Boolean);
        const rows = [...env.handles.byHandle.entries()].filter(([, s]) => words.every((w) => `${s.title} ${s.summary ?? ""}`.toLowerCase().includes(w)));
        if (!rows.length) return "No source matches.";
        return rows
          .slice(0, 200)
          .map(([h, s]) => `${h} "${s.title}" (${s.kind})${s.summary ? `: ${s.summary.replace(/\s+/g, " ").slice(0, 160)}` : ""}`)
          .join("\n");
      },
    }),
  };
}

export const TOOL_INSTRUCTION =
  "You can read more of the sources with tools: search_sources, get_outline, read_source (by pages or section) and list_sources. Use them when the passages above don't contain what the question needs, e.g. a whole chapter, a specific page, or a source no passage came from. Read only what you need. Every passage a tool returns has a number; cite it like the others.";
