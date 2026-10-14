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
    text: h.text,
  }));
}

export const CITE_RE = /\[(~?\d{1,3}(?:\s*[,;]\s*~?\d{1,3})*)\]/g;

/** Citation numbers referenced in the text, in first-use order, limited to known ones. */
export function citedNumbers(text: string, known: number): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(CITE_RE)) {
    for (const part of m[1].split(/[,;]/)) {
      const n = Number(part.trim().replace("~", ""));
      if (n >= 1 && n <= known && !out.includes(n)) out.push(n);
    }
  }
  return out;
}

/** general: the model marked it as general knowledge; uncited: prose with no citation and no matching passage */
export type Segment = { kind: "sourced" | "general" | "uncited"; text: string };

const OPEN = "{{general}}";
const CLOSE = "{{/general}}";

/**
 * Splits an answer into sourced and general-knowledge segments.
 * Explicit {{general}} markers always win. When the answer had sources in context, prose
 * paragraphs without any citation are flagged as uncited, since nothing ties them to a passage.
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
      push({ kind: uncited ? "uncited" : "sourced", text: block });
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

const STOP = new Set(
  "the and that this with from have which their there these those into about when where what will would could should been were they them then than also only such some more most other each very just like does doing your yours ours over under while because between after before during through".split(" "),
);

function contentWords(text: string): Set<string> {
  const out = new Set<string>();
  for (const w of text.toLowerCase().normalize("NFC").match(/[\p{L}\p{N}]{4,}/gu) ?? []) {
    if (!STOP.has(w)) out.add(w);
  }
  return out;
}

/** Share of a paragraph's content words that appear in the passage. */
export function overlap(paragraph: string, passage: string): number {
  const a = contentWords(paragraph);
  if (a.size < 5) return 0;
  const b = contentWords(passage);
  let hit = 0;
  for (const w of a) if (b.has(w)) hit++;
  return hit / a.size;
}

export const INFER_THRESHOLD = 0.5;

/**
 * Small models often cite only the first sentence. For each prose paragraph without a citation
 * (outside {{general}} blocks), attach `[~n]` when its wording clearly comes from passage n.
 * `~` marks it as matched by the app rather than cited by the model.
 */
export function inferCitations(text: string, passages: { n: number; text: string }[]): string {
  if (!passages.length) return text;
  const parts = text.split(/(\{\{general\}\}[\s\S]*?\{\{\/general\}\})/);
  return parts
    .map((part) => {
      if (part.startsWith("{{general}}")) return part;
      let inFence = false;
      return part
        .split(/(\n\s*\n)/)
        .map((block) => {
          const fences = (block.match(/^\s*```/gm) ?? []).length;
          const wasInFence = inFence;
          if (fences % 2 === 1) inFence = !inFence;
          if (wasInFence || fences > 0) return block;
          if (!block.trim() || /^\n\s*\n$/.test(block) || !isProse(block)) return block;
          if (citedNumbers(block, passages.length).length) return block;
          let best = { n: 0, score: 0 };
          for (const p of passages) {
            const sc = overlap(block, p.text);
            if (sc > best.score) best = { n: p.n, score: sc };
          }
          return best.score >= INFER_THRESHOLD ? `${block.replace(/\s+$/, "")} [~${best.n}]` : block;
        })
        .join("");
    })
    .join("");
}
