/**
 * Matching between the PDF's text layer (pdf.js) and the extracted source text (Rust). The two differ in
 * whitespace, hyphenation and ligatures, so both sides are compared with those removed.
 */

export interface Folded {
  /** text without whitespace or hyphens, ligatures expanded */
  norm: string;
  /** index in the original string for every character of `norm` */
  map: number[];
}

export function fold(text: string, from = 0, to = text.length): Folded {
  let norm = "";
  const map: number[] = [];
  for (let i = from; i < to; i++) {
    const c = text[i];
    if (/[\s\-­‐‑]/.test(c)) continue;
    const n = c.normalize("NFKC");
    for (const ch of n) {
      norm += ch;
      map.push(i);
    }
  }
  return { norm, map };
}

/** Every start index of `needle` in `hay`. */
export function occurrences(hay: string, needle: string): number[] {
  const out: number[] = [];
  if (!needle) return out;
  for (let i = hay.indexOf(needle); i !== -1; i = hay.indexOf(needle, i + 1)) out.push(i);
  return out;
}

/** The [start, end) of the page in the source text. */
export function pageRange(pages: [number, number][] | null, page: number, len: number): [number, number] {
  if (!pages?.length) return [0, len];
  const i = pages.findIndex(([p]) => p === page);
  if (i === -1) return [0, len];
  return [pages[i][1], i + 1 < pages.length ? pages[i + 1][1] : len];
}

/**
 * Source-text offsets for text selected on a PDF page. `nth` says which copy of the selection on the page
 * was chosen (0 = first). Falls back to the whole text when the page has no match.
 */
export function selectionToOffsets(text: string, range: [number, number], selected: string, nth = 0): { start: number; end: number } | null {
  const needle = fold(selected).norm;
  if (!needle) return null;
  for (const [from, to] of [range, [0, text.length] as [number, number]]) {
    const f = fold(text, from, to);
    const hits = occurrences(f.norm, needle);
    if (!hits.length) continue;
    const at = hits[Math.min(nth, hits.length - 1)];
    return { start: f.map[at], end: f.map[at + needle.length - 1] + 1 };
  }
  return null;
}

/** Where `quote` sits in the folded text-layer string, as [start, end) indices into `layer.norm`. */
export function quoteInLayer(layer: Pick<Folded, "norm">, quote: string): [number, number][] {
  const needle = fold(quote).norm;
  return occurrences(layer.norm, needle).map((i) => [i, i + needle.length]);
}
