import { glyphKeys } from "./font";

/** Markup (BEHAVIOR §2) → positioned dot-font boxes. Coordinates in dots, y relative to the baseline. */

export const CUR = "";
export const BLINK_ON = "";
export const BLINK_OFF = "";
export const OVER_ON = "\uE004";
export const OVER_OFF = "\uE005";
export const CUR_INS = "";
/** Empty whole-number slot of a mixed number (a normal-size placeholder). */
export const HOLE = "\uE006";
const SEQ = ["▸n/d◂▸Un/d", "▸F◂▸d"];

export type MNode =
  | { t: "g"; key: string }
  | { t: "frac"; a: MNode[]; b: MNode[] }
  | { t: "root"; i: MNode[]; a: MNode[] }
  | { t: "sqrt"; a: MNode[] }
  | { t: "sup"; a: MNode[] }
  | { t: "inv"; a: MNode[] }
  | { t: "blink"; a: MNode[] }
  | { t: "over"; a: MNode[] }
  | { t: "cur"; under?: boolean }
  | { t: "base" };

export interface Item {
  node: MNode;
  src: string;
}

/** Top-level items with their source text, so long rows can be cut at item boundaries. */
export function parseItems(s: string): Item[] {
  let i = 0;
  const seq = (stop: string | null): Item[] => {
    const out: Item[] = [];
    while (i < s.length) {
      const start = i;
      const c = s[i];
      if (stop && c === stop) {
        i++;
        return out;
      }
      let node: MNode;
      if (s.startsWith("\\f{", i) || s.startsWith("\\r{", i)) {
        const isFrac = s[i + 1] === "f";
        i += 3;
        const a = seq("}").map((x) => x.node);
        i++;
        const b = seq("}").map((x) => x.node);
        node = isFrac ? { t: "frac", a, b } : { t: "root", i: a, a: b };
      } else if (s.startsWith("√{", i)) {
        i += 2;
        node = { t: "sqrt", a: seq("}").map((x) => x.node) };
      } else if (s.startsWith("^{", i)) {
        i += 2;
        node = { t: "sup", a: seq("}").map((x) => x.node) };
      } else if (c === "«") {
        i++;
        node = { t: "inv", a: seq("»").map((x) => x.node) };
      } else if (c === OVER_ON) {
        i++;
        node = { t: "over", a: seq(OVER_OFF).map((x) => x.node) };
      } else if (c === BLINK_ON) {
        i++;
        node = { t: "blink", a: seq(BLINK_OFF).map((x) => x.node) };
      } else if (c === HOLE) {
        i++;
        node = { t: "base" };
      } else if (c === CUR || c === CUR_INS) {
        i++;
        node = { t: "cur", under: c === CUR_INS };
      } else {
        const text = SEQ.find((q) => s.startsWith(q, i)) ?? glyphKeys(s.slice(i, i + 4))[0];
        i += text.length;
        glyphKeys(text).forEach((k, j) => out.push({ node: { t: "g", key: k }, src: j === 0 ? text : "" }));
        continue;
      }
      out.push({ node, src: s.slice(start, i) });
    }
    return out;
  };
  return seq(null);
}

export const parse = (s: string): MNode[] => parseItems(s).map((x) => x.node);

/** n: normal 5×7 in 6×8 cells; s: small 5×5 at 6-dot pitch; m: menu 4×5 at 5-dot pitch (BEHAVIOR §3.1). */
export type FontId = "n" | "s" | "m";
const PITCH: Record<FontId, number> = { n: 6, s: 6, m: 5 };
const GLYPH_H: Record<FontId, number> = { n: 7, s: 5, m: 5 };
const DESC: Record<FontId, number> = { n: 1, s: 0, m: 1 };

export type Op =
  | { k: "g"; key: string; font: FontId; x: number; y: number }
  | { k: "rect"; x: number; y: number; w: number; h: number }
  | { k: "inv"; x: number; y: number; w: number; h: number }
  | { k: "cur"; x: number; y: number; w: number; h: number }
  | { k: "blink"; x: number; y: number; w: number; h: number }
  | { k: "solid"; x: number; y: number; w: number; h: number };

export interface Box {
  w: number;
  asc: number;
  desc: number;
  ops: Op[];
}

const shift = (ops: Op[], dx: number, dy: number): Op[] => ops.map((o) => ({ ...o, x: o.x + dx, y: o.y + dy }));

const PAREN_ROWS = { open: [2, 1, 0], close: [0, 1, 2] };

/** A parenthesis 9 dots tall around a superscript, 13 around or before a stacked fraction (BEHAVIOR §3.1). */
function tallParen(key: string, h: 9 | 13): Op[] {
  const edge = key === "(" ? PAREN_ROWS.open : PAREN_ROWS.close;
  const top = h === 13 ? -10 : -9;
  const ops: Op[] = [];
  for (let r = 0; r < h; r++) {
    const k = Math.min(r, h - 1 - r);
    ops.push({ k: "rect", x: 1 + (k < 2 ? edge[k] : edge[2]), y: top + r, w: 1, h: 1 });
  }
  return ops;
}

function parenHeights(nodes: MNode[]): (9 | 13 | undefined)[] {
  const isP = (n: MNode, k: string) => n.t === "g" && n.key === k;
  const group = (from: number, to: number) => {
    const g = nodes.slice(from, to);
    return g.some((n) => n.t === "frac") ? 13 : g.some((n) => n.t === "sup") ? 9 : undefined;
  };
  return nodes.map((n, i) => {
    if (isP(n, "(")) {
      let depth = 0;
      let j = i;
      for (; j < nodes.length; j++) {
        if (isP(nodes[j], "(")) depth++;
        else if (isP(nodes[j], ")") && --depth === 0) break;
      }
      return group(i + 1, j);
    }
    if (isP(n, ")")) {
      let depth = 0;
      let j = i;
      for (; j >= 0; j--) {
        if (isP(nodes[j], ")")) depth++;
        else if (isP(nodes[j], "(") && --depth === 0) break;
      }
      return group(j + 1, i);
    }
    return undefined;
  });
}

export function layoutSeq(nodes: MNode[], font: FontId = "n", inSup = false): Box {
  const ops: Op[] = [];
  let x = 0;
  let asc = GLYPH_H[font];
  let desc = DESC[font];
  const tall = font === "n" ? parenHeights(nodes) : [];
  nodes.forEach((n, i) => {
    let b = layoutNode(n, font, inSup);
    const t = tall[i];
    if (t && n.t === "g") b = { ...b, asc: t === 13 ? 10 : 9, desc: t === 13 ? 3 : b.desc, ops: tallParen(n.key, t) };
    // the cursor on an empty whole-number slot fills its placeholder
    if (n.t === "cur" && nodes[i + 1]?.t === "base") b = { ...b, ops: [{ k: "solid", x: 0, y: -GLYPH_H[font], w: 5, h: GLYPH_H[font] }] };
    ops.push(...shift(b.ops, x, 0));
    // the cursor in front of a stacked fraction (after a mixed number's whole part) takes a cell of its own
    x += b.w + (n.t === "cur" && nodes[i + 1]?.t === "frac" && nodes[i - 1]?.t === "g" ? PITCH[font] : 0);
    asc = Math.max(asc, b.asc);
    desc = Math.max(desc, b.desc);
  });
  return { w: x, asc, desc, ops };
}

/** A slot that starts with an exponent has no base: the base shows as a placeholder box. */
const baseless = (nodes: MNode[]) => nodes.find((n) => n.t !== "cur")?.t === "sup";

export const isEmptySlot = (nodes: MNode[]) => nodes.every((n) => n.t === "cur");

/** Dotted placeholder box: the outline of a glyph cell with every second dot lit. */
function placeholder(font: FontId): Op[] {
  const h = GLYPH_H[font];
  const w = font === "m" ? 4 : 5;
  const ops: Op[] = [];
  for (let r = 0; r < h; r += 2) {
    const edge = r === 0 || r === h - 1;
    for (let c = 0; c < w; c += edge ? 2 : w - 1) ops.push({ k: "rect", x: c, y: r - h, w: 1, h: 1 });
  }
  return ops;
}

/** An empty template slot is a placeholder box; a cursor in it fills the box while the cursor is on. */
function layoutSlot(nodes: MNode[], font: FontId, inSup = false): Box {
  if (!isEmptySlot(nodes)) return layoutSeq(baseless(nodes) ? [{ t: "base" }, ...nodes] : nodes, font, inSup);
  const h = GLYPH_H[font];
  const ops = placeholder(font);
  if (nodes.length) ops.push({ k: "solid", x: 0, y: -h, w: font === "m" ? 4 : 5, h });
  return { w: PITCH[font], asc: h, desc: DESC[font], ops };
}

function layoutNode(n: MNode, font: FontId, inSup = false): Box {
  const h = GLYPH_H[font];
  const p = PITCH[font];
  const sub: FontId = font === "m" ? "m" : "s";
  switch (n.t) {
    case "g":
      return { w: p, asc: h, desc: DESC[font], ops: [{ k: "g", key: n.key, font, x: 0, y: -h }] };
    case "base":
      return { w: p, asc: h, desc: DESC[font], ops: placeholder(font) };
    case "cur":
      return { w: 0, asc: h, desc: 0, ops: [{ k: "cur", x: 0, y: n.under ? 0 : -h, w: p - 1, h: n.under ? 1 : h }] };
    case "sup": {
      const e = layoutSlot(n.a, sub, true);
      const dy = font === "n" ? -4 : -2;
      return { w: e.w, asc: e.asc - dy, desc: Math.max(0, e.desc + dy), ops: shift(e.ops, 0, dy) };
    }
    case "frac": {
      // wider part + 1 cells; parts start half a cell in (BEHAVIOR §3.1). In a superscript it keeps the normal size.
      const a = layoutSlot(n.a, sub);
      const b = layoutSlot(n.b, sub);
      const inner = Math.max(a.w, b.w, p);
      const half = p / 2;
      const bar = font === "n" ? -4 : inSup ? -7 : -3;
      const gap = font === "n" || inSup ? 1 : 0;
      const numDy = bar - gap - a.desc;
      const denDy = bar + 1 + gap + b.asc;
      const ops: Op[] = [
        ...shift(a.ops, half + Math.floor((inner - a.w) / 2), numDy),
        { k: "rect", x: 1, y: bar, w: inner + half, h: 1 },
        ...shift(b.ops, half + Math.floor((inner - b.w) / 2), denDy),
      ];
      return { w: inner + p, asc: a.asc - numDy, desc: Math.max(DESC[font], denDy + b.desc), ops };
    }
    case "sqrt":
    case "root": {
      const r = layoutSlot(n.a, font);
      const idx = n.t === "root" ? layoutSlot(n.i, sub) : null;
      const ox = idx ? idx.w : 0;
      const barY = -r.asc - 1;
      const ops: Op[] = [];
      if (idx) ops.push(...shift(idx.ops, 0, -3));
      ops.push(
        { k: "rect", x: ox, y: -3, w: 1, h: 1 },
        { k: "rect", x: ox + 1, y: -2, w: 1, h: 2 },
        { k: "rect", x: ox + 2, y: -h, w: 1, h },
        { k: "rect", x: ox + 3, y: barY, w: 1, h: -barY - h },
        { k: "rect", x: ox + 3, y: barY, w: r.w + 2, h: 1 },
        ...shift(r.ops, ox + p, 0),
      );
      return { w: ox + p + r.w, asc: Math.max(r.asc + 1, idx ? idx.asc + 3 : 0), desc: Math.max(r.desc, DESC[font]), ops };
    }
    case "over": {
      const c = layoutSeq(n.a, font);
      return { w: c.w, asc: c.asc + 1, desc: c.desc, ops: [...c.ops, { k: "rect", x: 0, y: -c.asc - 1, w: c.w, h: 1 }] };
    }
    case "inv":
    case "blink": {
      const c = layoutSeq(n.a, font);
      const box = { x: -1, y: -c.asc, w: c.w, h: c.asc + DESC[font] };
      return { w: c.w, asc: c.asc, desc: c.desc, ops: [...c.ops, { k: n.t, ...box }] };
    }
  }
}

export function layout(markup: string, font: FontId = "n"): Box {
  return layoutSeq(parse(markup), font);
}

export function measure(markup: string): { w: number; h: number } {
  const b = layout(markup);
  return { w: b.w, h: b.asc + b.desc };
}

/** Character cells (BEHAVIOR §3.2): fractions count their wider part, √ counts one cell; an empty slot is one cell. */
export function cells(nodes: MNode[]): number {
  const slot = (ns: MNode[]) => (isEmptySlot(ns) ? 1 : cells(ns) + (baseless(ns) ? 1 : 0));
  let c = 0;
  for (const n of nodes) {
    switch (n.t) {
      case "g":
        c += 1;
        break;
      case "sup":
        c += slot(n.a);
        break;
      case "inv":
      case "blink":
      case "over":
        c += cells(n.a);
        break;
      case "frac":
        c += Math.max(slot(n.a), slot(n.b)) + 1;
        break;
      case "base":
        c += 1;
        break;
      case "sqrt":
        c += 1 + slot(n.a);
        break;
      case "root":
        c += slot(n.i) + 1 + slot(n.a);
        break;
    }
  }
  return c;
}

/** Markup text of parsed nodes (inverse of `parse`). */
export function serialize(nodes: MNode[]): string {
  return nodes
    .map((n) => {
      switch (n.t) {
        case "g":
          return n.key;
        case "cur":
          return n.under ? CUR_INS : CUR;
        case "frac":
          return `\\f{${serialize(n.a)}}{${serialize(n.b)}}`;
        case "root":
          return `\\r{${serialize(n.i)}}{${serialize(n.a)}}`;
        case "sqrt":
          return `√{${serialize(n.a)}}`;
        case "sup":
          return `^{${serialize(n.a)}}`;
        case "inv":
          return `«${serialize(n.a)}»`;
        case "over":
          return OVER_ON + serialize(n.a) + OVER_OFF;
        case "blink":
          return BLINK_ON + serialize(n.a) + BLINK_OFF;
        case "base":
          return HOLE;
      }
    })
    .join("");
}
