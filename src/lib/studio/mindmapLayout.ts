import type { MindNode } from "./kinds";

export interface LaidNode {
  id: string;
  label: string;
  depth: number;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface LaidEdge {
  from: string;
  to: string;
}

const CHAR_W = 7.2;
const PAD_X = 12;
const NODE_H = 30;
const GAP_Y = 10;
const GAP_X = 44;

const nodeW = (label: string, depth: number) => Math.min(220, Math.round(label.length * (depth === 0 ? 8.4 : CHAR_W)) + PAD_X * 2);

/** Left-to-right tree: each leaf gets one row, parents sit centred on their children. */
export function layoutMindmap(root: MindNode): { nodes: LaidNode[]; edges: LaidEdge[]; width: number; height: number } {
  const nodes: LaidNode[] = [];
  const edges: LaidEdge[] = [];
  const colX: number[] = [];
  const colW: number[] = [];
  const widest = (n: MindNode, d: number) => {
    colW[d] = Math.max(colW[d] ?? 0, nodeW(n.label, d));
    n.children.forEach((c) => widest(c, d + 1));
  };
  widest(root, 0);
  colW.forEach((_, d) => (colX[d] = d === 0 ? 0 : colX[d - 1] + colW[d - 1] + GAP_X));
  let row = 0;
  const place = (n: MindNode, depth: number, id: string): number => {
    let cy: number;
    if (n.children.length === 0) {
      cy = row * (NODE_H + GAP_Y) + NODE_H / 2;
      row++;
    } else {
      const ys = n.children.map((c, i) => {
        const cid = `${id}.${i}`;
        edges.push({ from: id, to: cid });
        return place(c, depth + 1, cid);
      });
      cy = (ys[0] + ys[ys.length - 1]) / 2;
    }
    nodes.push({ id, label: n.label, depth, x: colX[depth], y: cy - NODE_H / 2, w: nodeW(n.label, depth), h: NODE_H });
    return cy;
  };
  place(root, 0, "0");
  const width = Math.max(...nodes.map((n) => n.x + n.w));
  const height = Math.max(NODE_H, row * (NODE_H + GAP_Y) - GAP_Y);
  return { nodes, edges, width, height };
}

/** Greedy word wrap for SVG text, by character count. */
export function wrapText(text: string, maxChars: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const w of text.split(/\s+/).filter(Boolean)) {
    if (line && (line + " " + w).length > maxChars) {
      lines.push(line);
      line = w;
    } else line = line ? line + " " + w : w;
  }
  if (line) lines.push(line);
  return lines;
}
