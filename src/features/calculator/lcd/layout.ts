import { glyphKeys } from "./font";

/** Markup (BEHAVIOR §2) → positioned dot-font boxes. Coordinates in dots, y relative to the baseline. */

export const CUR = "";
export const BLINK_ON = "";
export const BLINK_OFF = "";
export const CUR_INS = "";
const SEQ = ["▸n/d◂▸Un/d", "▸F◂▸d"];

export type MNode =
  | { t: "g"; key: string }
  | { t: "frac"; a: MNode[]; b: MNode[] }
  | { t: "root"; i: MNode[]; a: MNode[] }
  | { t: "sqrt"; a: MNode[] }
  | { t: "sup"; a: MNode[] }
  | { t: "inv"; a: MNode[] }
  | { t: "blink"; a: MNode[] }
  | { t: "cur"; under?: boolean };

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
      } else if (c === BLINK_ON) {
        i++;
        node = { t: "blink", a: seq(BLINK_OFF).map((x) => x.node) };
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
  | { k: "blink"; x: number; y: number; w: number; h: number };

export interface Box {
  w: number;
  asc: number;
  desc: number;
  ops: Op[];
}

const shift = (ops: Op[], dx: number, dy: number): Op[] => ops.map((o) => ({ ...o, x: o.x + dx, y: o.y + dy }));

export function layoutSeq(nodes: MNode[], font: FontId = "n"): Box {
  const ops: Op[] = [];
  let x = 0;
  let asc = GLYPH_H[font];
  let desc = DESC[font];
  for (const n of nodes) {
    const b = layoutNode(n, font);
    ops.push(...shift(b.ops, x, 0));
    x += b.w;
    asc = Math.max(asc, b.asc);
    desc = Math.max(desc, b.desc);
  }
  return { w: x, asc, desc, ops };
}

function layoutNode(n: MNode, font: FontId): Box {
  const h = GLYPH_H[font];
  const p = PITCH[font];
  const sub: FontId = font === "m" ? "m" : "s";
  switch (n.t) {
    case "g":
      return { w: p, asc: h, desc: DESC[font], ops: [{ k: "g", key: n.key, font, x: 0, y: -h }] };
    case "cur":
      return { w: 0, asc: h, desc: 0, ops: [{ k: "cur", x: 0, y: n.under ? 0 : -h, w: p - 1, h: n.under ? 1 : h }] };
    case "sup": {
      const e = layoutSeq(n.a, sub);
      const dy = font === "n" ? -4 : -2;
      const ops = shift(e.ops, 0, dy);
      if (!n.a.length) ops.push({ k: "rect", x: 0, y: dy - 5, w: 5, h: 1 }, { k: "rect", x: 0, y: dy - 1, w: 5, h: 1 });
      return { w: n.a.length ? e.w : p, asc: e.asc - dy, desc: Math.max(0, e.desc + dy), ops };
    }
    case "frac": {
      const a = layoutSeq(n.a, sub);
      const b = layoutSeq(n.b, sub);
      const w = Math.max(a.w, b.w, p);
      const bar = font === "n" ? -4 : -3;
      const gap = font === "n" ? 1 : 0;
      const numDy = bar - gap - a.desc;
      const denDy = bar + 1 + gap + b.asc;
      const ops: Op[] = [
        ...shift(a.ops, Math.floor((w - a.w) / 2), numDy),
        { k: "rect", x: -1, y: bar, w: w + 1, h: 1 },
        ...shift(b.ops, Math.floor((w - b.w) / 2), denDy),
      ];
      return { w, asc: a.asc - numDy, desc: denDy + b.desc, ops };
    }
    case "sqrt":
    case "root": {
      const r = layoutSeq(n.a, font);
      const idx = n.t === "root" ? layoutSeq(n.i, sub) : null;
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

/** Character cells (BEHAVIOR §3.2): fractions count their wider part, √ counts one cell. */
export function cells(nodes: MNode[]): number {
  let c = 0;
  for (const n of nodes) {
    switch (n.t) {
      case "g":
        c += 1;
        break;
      case "sup":
      case "inv":
      case "blink":
        c += cells(n.a);
        break;
      case "frac":
        c += Math.max(cells(n.a), cells(n.b));
        break;
      case "sqrt":
        c += 1 + cells(n.a);
        break;
      case "root":
        c += cells(n.i) + 1 + cells(n.a);
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
        case "blink":
          return BLINK_ON + serialize(n.a) + BLINK_OFF;
      }
    })
    .join("");
}
