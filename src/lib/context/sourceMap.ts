import type { OutlineEntry, Source, SourceOutline } from "../types";
import { countTokens } from "./tokens";

/** Short handles (S1, S2…) the model uses to name sources in tool calls and the map. */
export interface Handles {
  byHandle: Map<string, Source>;
  byId: Map<string, string>;
}

export function makeHandles(sources: Source[]): Handles {
  const sorted = [...sources].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const byHandle = new Map<string, Source>();
  const byId = new Map<string, string>();
  sorted.forEach((s, i) => {
    byHandle.set(`S${i + 1}`, s);
    byId.set(s.id, `S${i + 1}`);
  });
  return { byHandle, byId };
}

function size(s: Source, outline?: SourceOutline): string {
  const pages = outline?.entries.reduce((m, e) => Math.max(m, e.pageTo ?? 0), 0);
  const k = Math.round(s.charCount / 1000);
  const words = k >= 1000 ? `${(k / 1000).toFixed(1)}M chars` : `${k}k chars`;
  return pages ? `${pages} pages, ${words}` : words;
}

const firstSentence = (t: string) => {
  const m = /^(.{20,240}?[.!?])(\s|$)/s.exec(t.trim());
  return (m?.[1] ?? t.trim().slice(0, 200)).replace(/\s+/g, " ");
};

function range(e: OutlineEntry): string {
  if (e.pageFrom != null) return e.pageTo != null && e.pageTo !== e.pageFrom ? ` (p. ${e.pageFrom}–${e.pageTo})` : ` (p. ${e.pageFrom})`;
  return "";
}

function outlineText(o: SourceOutline | undefined, max: number): string {
  if (!o?.entries.length) return "";
  const top = o.entries.filter((e) => e.level === 1);
  const list = (top.length >= 3 ? top : o.entries).slice(0, max);
  const more = (top.length >= 3 ? top : o.entries).length - list.length;
  return `\n  Outline: ${list.map((e) => `${e.title}${range(e)}`).join("; ")}${more > 0 ? `; … ${more} more` : ""}`;
}

export type MapLevel = "full" | "brief" | "titles";

export function mapLine(handle: string, s: Source, outline: SourceOutline | undefined, level: MapLevel): string {
  const mode = s.contextMode === "full" ? ", full text below" : s.contextMode === "summary" ? ", summary only" : "";
  const head = `${handle} "${s.title}" (${s.kind}, ${size(s, outline)}${mode})`;
  if (level === "titles") return `- ${head}`;
  const summary = s.summary ? `: ${level === "full" ? s.summary.replace(/\s+/g, " ").trim() : firstSentence(s.summary)}` : "";
  return `- ${head}${summary}${level === "full" ? outlineText(outline, 14) : ""}`;
}

export interface SourceMap {
  text: string;
  tokens: number;
  level: MapLevel;
  /** sources listed by name only past the budget */
  omitted: number;
}

/**
 * Every enabled source as one entry, richest level that fits `budget`: summary + outline, then a
 * one-line summary, then titles. Past that, the list ends with a count the model can explore with tools.
 */
export function buildSourceMap(sources: Source[], outlines: Map<string, SourceOutline>, handles: Handles, budget: number): SourceMap {
  const ordered = [...handles.byHandle.entries()].filter(([, s]) => sources.some((x) => x.id === s.id));
  for (const level of ["full", "brief", "titles"] as MapLevel[]) {
    const lines = ordered.map(([h, s]) => mapLine(h, s, outlines.get(s.id), level));
    const text = lines.join("\n");
    const tokens = countTokens(text);
    if (tokens <= budget) return { text, tokens, level, omitted: 0 };
  }
  const lines: string[] = [];
  let tokens = 0;
  for (const [h, s] of ordered) {
    const l = mapLine(h, s, undefined, "titles");
    const t = countTokens(l) + 1;
    if (tokens + t > budget - 30) break;
    lines.push(l);
    tokens += t;
  }
  const omitted = ordered.length - lines.length;
  lines.push(`- … and ${omitted} more sources (use list_sources to see them).`);
  const text = lines.join("\n");
  return { text, tokens: countTokens(text), level: "titles", omitted };
}
