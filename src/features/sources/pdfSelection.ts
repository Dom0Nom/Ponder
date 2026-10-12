import { fold, occurrences, pageRange, selectionToOffsets } from "../../lib/sources/pdfAnchor";
import type { SourceText } from "../../lib/types";

export type Layer = { norm: string; nodes: Text[]; at: [number, number][] };

/** The text layer's characters, folded like the source text, with the DOM position of each. */
export function readLayer(div: HTMLElement): Layer {
  const nodes: Text[] = [];
  const at: [number, number][] = [];
  let norm = "";
  const walk = document.createTreeWalker(div, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode() as Text | null; n; n = walk.nextNode() as Text | null) {
    const f = fold(n.data);
    nodes.push(n);
    norm += f.norm;
    for (const i of f.map) at.push([nodes.length - 1, i]);
  }
  return { norm, nodes, at };
}

/** Source offsets for the current selection if it sits on a rendered PDF page. */
export function pdfSelectionOffsets(root: Element, st: SourceText): { start: number; end: number } | null {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || !sel.rangeCount) return null;
  const r = sel.getRangeAt(0);
  const page = (r.startContainer.nodeType === Node.ELEMENT_NODE ? (r.startContainer as Element) : r.startContainer.parentElement)?.closest<HTMLElement>("[data-pdf-page]");
  if (!page || !root.contains(page)) return null;
  const layer = page.querySelector<HTMLElement>(".textLayer");
  if (!layer) return null;
  const selected = sel.toString();
  const needle = fold(selected).norm;
  const before = document.createRange();
  before.setStart(layer, 0);
  before.setEnd(r.startContainer, r.startOffset);
  const prefix = fold(before.toString()).norm.length;
  const nth = occurrences(readLayer(layer).norm, needle).filter((i) => i < prefix).length;
  return selectionToOffsets(st.text, pageRange(st.pages, Number(page.dataset.pdfPage), st.text.length), selected, nth);
}
