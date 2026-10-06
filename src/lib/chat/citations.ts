import type { Citation, SearchHit } from "../types";

export function hitsToCitations(hits: SearchHit[]): Citation[] {
  return hits.map((h, i) => ({
    n: i + 1,
    chunkId: h.chunkId,
    sourceId: h.sourceId,
    sourceTitle: h.sourceTitle,
    start: h.start,
    end: h.end,
    page: h.page,
    snippet: h.text.length > 280 ? `${h.text.slice(0, 277)}…` : h.text,
  }));
}

export const CITE_RE = /\[(\d{1,2}(?:\s*[,;]\s*\d{1,2})*)\]/g;

/** Citation numbers referenced in the text, in first-use order, limited to known ones. */
export function citedNumbers(text: string, known: number): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(CITE_RE)) {
    for (const part of m[1].split(/[,;]/)) {
      const n = Number(part.trim());
      if (n >= 1 && n <= known && !out.includes(n)) out.push(n);
    }
  }
  return out;
}

export type Segment = { kind: "sourced" | "general"; text: string };

const OPEN = "{{general}}";
const CLOSE = "{{/general}}";

/**
 * Splits an answer into sourced and general-knowledge segments.
 * Explicit {{general}} markers always win. When the answer had sources in context, prose
 * paragraphs without any citation are also treated as general knowledge, since nothing ties
 * them to a passage.
 */
export function splitSegments(text: string, opts: { hadSources: boolean; known: number }): Segment[] {
  const raw: Segment[] = [];
  let rest = text;
  while (rest.length) {
    const o = rest.indexOf(OPEN);
    if (o === -1) {
      raw.push({ kind: "sourced", text: rest });
      break;
    }
    if (o > 0) raw.push({ kind: "sourced", text: rest.slice(0, o) });
    const after = rest.slice(o + OPEN.length);
    const c = after.indexOf(CLOSE);
    if (c === -1) {
      // still streaming, or the model forgot to close it
      raw.push({ kind: "general", text: after });
      break;
    }
    raw.push({ kind: "general", text: after.slice(0, c) });
    rest = after.slice(c + CLOSE.length);
  }

  const out: Segment[] = [];
  const push = (seg: Segment) => {
    if (!seg.text.trim()) return;
    const last = out[out.length - 1];
    if (last && last.kind === seg.kind) last.text += `\n\n${seg.text.trim()}`;
    else out.push({ kind: seg.kind, text: seg.text.trim() });
  };

  for (const seg of raw) {
    if (seg.kind === "general" || !opts.hadSources) {
      push({ kind: opts.hadSources ? seg.kind : "general", text: seg.text });
      continue;
    }
    for (const block of splitBlocks(seg.text)) {
      const uncited = isProse(block) && citedNumbers(block, opts.known).length === 0;
      push({ kind: uncited ? "general" : "sourced", text: block });
    }
  }
  return out;
}

/** Paragraph blocks, keeping fenced code blocks and lists together. */
function splitBlocks(text: string): string[] {
  const blocks: string[] = [];
  let cur: string[] = [];
  let inFence = false;
  for (const line of text.split("\n")) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    if (!inFence && line.trim() === "") {
      if (cur.length) blocks.push(cur.join("\n"));
      cur = [];
    } else cur.push(line);
  }
  if (cur.length) blocks.push(cur.join("\n"));
  return blocks;
}

/** Long enough prose to carry a factual claim; headings, code and short lead-ins don't. */
function isProse(block: string): boolean {
  const t = block.trim();
  if (t.startsWith("```") || t.startsWith("#") || t.startsWith("|")) return false;
  if (t.length < 80) return false;
  if (/[?:]$/.test(t)) return false;
  return true;
}
