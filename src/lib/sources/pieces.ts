import type { SourceText } from "../types";

export type Piece = { text: string; mark: boolean; page?: number };

/** Splits the text at page starts and the highlight range so each piece renders on its own. */
export function buildPieces(st: SourceText, start?: number, end?: number): Piece[] {
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
  const sorted = [...cuts].sort((a, b) => a - b);
  const out: Piece[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    out.push({
      text: st.text.slice(a, b),
      mark: hasMark && a >= start! && b <= end!,
      page: pageAt.get(a),
    });
  }
  if (!out.length && pageAt.has(0)) out.push({ text: "", mark: false, page: pageAt.get(0) });
  return out;
}
