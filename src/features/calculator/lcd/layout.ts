import { glyph, glyphKeys } from "./font";

/** Markup (BEHAVIOR §2) → positioned dot-font boxes. Coordinates in dots, y relative to the baseline. */

export const CUR = "\uE000";
export const BLINK_ON = "\uE001";
export const BLINK_OFF = "\uE002";
const SEQ = ["▸n/d◂▸Un/d", "▸F◂▸D", "▸DMS", "▸%"];

export type MNode =
  | { t: "g"; key: string }
  | { t: "frac"; a: MNode[]; b: MNode[] }
  | { t: "root"; i: MNode[]; a: MNode[] }
  | { t: "sqrt"; a: MNode[] }
  | { t: "sup"; a: MNode[] }
  | { t: "inv"; a: MNode[] }
  | { t: "blink"; a: MNode[] }
  | { t: "cur" };

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
      } else if (c === CUR) {
        i++;
        node = { t: "cur" };
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

export type Op =
  | { k: "g"; key: string; small: boolean; x: number; y: number }
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

export function layoutSeq(nodes: MNode[], small = false): Box {
  const ops: Op[] = [];
  let x = 0;
  let asc = small ? 5 : 7;
  let desc = small ? 0 : 1;
  for (const n of nodes) {
    const b = layoutNode(n, small);
    ops.push(...shift(b.ops, x, 0));
    x += b.w;
    asc = Math.max(asc, b.asc);
    desc = Math.max(desc, b.desc);
  }
  return { w: x, asc, desc, ops };
}

function layoutNode(n: MNode, small: boolean): Box {
  const ascBase = small ? 5 : 7;
  switch (n.t) {
    case "g": {
      const useSmall = small;
      const g = glyph(n.key, useSmall);
      const h = g.rows.length;
      const top = useSmall && h <= 5 ? -5 : -7;
      return {
        w: g.w + 1,
        asc: -top,
        desc: small ? 0 : 1,
        ops: [{ k: "g", key: n.key, small: useSmall && h <= 5, x: 0, y: top }],
      };
    }
    case "cur":
      return { w: 0, asc: ascBase, desc: 0, ops: [{ k: "cur", x: 0, y: -ascBase, w: small ? 3 : 5, h: ascBase }] };
    case "sup": {
      const e = layoutSeq(n.a, true);
      const raise = small ? 3 : 5;
      const w = Math.max(e.w, 2);
      const ops = shift(e.ops, 0, -raise);
      if (!n.a.length) ops.push({ k: "rect", x: 0, y: -raise - 5, w: 3, h: 1 });
      return { w: w + (n.a.length ? 0 : 2), asc: raise + e.asc, desc: 0, ops };
    }
    case "frac": {
      const a = layoutSeq(n.a, small);
      const b = layoutSeq(n.b, small);
      const inner = Math.max(a.w, b.w, small ? 4 : 6);
      const bar = small ? -2 : -4;
      const numBase = bar - Math.max(a.desc, 1);
      const denBase = bar + 2 + b.asc;
      const ops: Op[] = [
        ...shift(a.ops, 1 + Math.floor((inner - a.w) / 2), numBase),
        { k: "rect", x: 0, y: bar, w: inner + 1, h: 1 },
        ...shift(b.ops, 1 + Math.floor((inner - b.w) / 2), denBase),
      ];
      return { w: inner + 2, asc: -(numBase - a.asc), desc: denBase + Math.max(b.desc - 1, 0), ops };
    }
    case "sqrt":
    case "root": {
      const r = layoutSeq(n.a, small);
      const idx = n.t === "root" ? layoutSeq(n.i, true) : null;
      const ox = idx ? Math.max(idx.w - 2, 0) : 0;
      const barY = -r.asc - 2;
      const ops: Op[] = [];
      if (idx) ops.push(...shift(idx.ops, 0, -4));
      ops.push(
        { k: "rect", x: ox, y: -3, w: 1, h: 1 },
        { k: "rect", x: ox + 1, y: -2, w: 1, h: 2 },
        { k: "rect", x: ox + 2, y: barY, w: 1, h: -barY },
        { k: "rect", x: ox + 2, y: barY, w: r.w + 2, h: 1 },
        ...shift(r.ops, ox + 4, 0),
      );
      const asc = Math.max(r.asc + 2, idx ? 4 + idx.asc : 0);
      return { w: ox + 4 + r.w + 1, asc, desc: Math.max(r.desc, small ? 0 : 1), ops };
    }
    case "inv": {
      const c = layoutSeq(n.a, small);
      const h = c.asc + 1;
      return { w: c.w + 1, asc: c.asc, desc: c.desc, ops: [...shift(c.ops, 1, 0), { k: "inv", x: 0, y: -c.asc, w: c.w + 1, h }] };
    }
    case "blink": {
      const c = layoutSeq(n.a, small);
      return { w: c.w + 1, asc: c.asc, desc: c.desc, ops: [...shift(c.ops, 1, 0), { k: "blink", x: 0, y: -c.asc, w: c.w + 1, h: c.asc + 1 }] };
    }
  }
}

export function layout(markup: string, small = false): Box {
  return layoutSeq(parse(markup), small);
}

export function measure(markup: string): { w: number; h: number } {
  const b = layout(markup);
  return { w: b.w, h: b.asc + b.desc };
}

/** Character cells used by the Home row-placement rule: an entry's superscript also counts its caret. */
export function cells(nodes: MNode[], entry: boolean): number {
  let c = 0;
  for (const n of nodes) {
    switch (n.t) {
      case "g":
        c += 1;
        break;
      case "sup":
        c += (entry ? 1 : 0) + cells(n.a, entry);
        break;
      case "frac":
        c += Math.max(cells(n.a, entry), cells(n.b, entry));
        break;
      case "sqrt":
        c += 1 + cells(n.a, entry);
        break;
      case "root":
        c += cells(n.i, entry) + 1 + cells(n.a, entry);
        break;
      case "inv":
      case "blink":
        c += cells(n.a, entry);
        break;
    }
  }
  return c;
}
