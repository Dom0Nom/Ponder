import type { Annotation, SourceText } from "../types";

export type Piece = { text: string; mark: boolean; page?: number; start: number; annot?: string };

type Range = { id: string; start: number; end: number };

/** Splits the text at page starts, the cited range and the learner's highlights so each piece renders on its own. */
export function buildPieces(st: SourceText, start?: number, end?: number, annots: Range[] = []): Piece[] {
  const len = st.text.length;
  const hasMark = start != null && end != null && end > start && start < len;
  const cuts = new Set<number>([0, len]);
  const pageAt = new Map<number, number>();
  for (const [page, off] of st.pages ?? []) {
    if (off >= 0 && off <= len) {
      cuts.add(off);
      pageAt.set(off, page);
    }
  }
  if (hasMark) {
    cuts.add(Math.max(0, start!));
    cuts.add(Math.min(len, end!));
  }
  const live = annots.filter((a) => a.start >= 0 && a.end > a.start && a.start < len);
  for (const a of live) {
    cuts.add(a.start);
    cuts.add(Math.min(len, a.end));
  }
  const sorted = [...cuts].sort((a, b) => a - b);
  const out: Piece[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    out.push({
      text: st.text.slice(a, b),
      mark: hasMark && a >= start! && b <= end!,
      page: pageAt.get(a),
      start: a,
      annot: live.find((x) => a >= x.start && b <= x.end)?.id,
    });
  }
  if (!out.length && pageAt.has(0)) out.push({ text: "", mark: false, page: pageAt.get(0), start: 0 });
  return out;
}

/** Where each highlight sits in the current text: its stored range if the quote still matches, else the nearest copy of the quote, else -1 (detached). */
export function anchorAnnotations(text: string, list: Annotation[]): (Annotation & { detached: boolean })[] {
  return list.map((a) => {
    if (text.slice(a.start, a.end) === a.quote) return { ...a, detached: false };
    let best = -1;
    for (let i = text.indexOf(a.quote); i !== -1; i = text.indexOf(a.quote, i + 1)) {
      if (best === -1 || Math.abs(i - a.start) < Math.abs(best - a.start)) best = i;
    }
    return best === -1 ? { ...a, start: -1, end: -1, detached: true } : { ...a, start: best, end: best + a.quote.length, detached: false };
  });
}
