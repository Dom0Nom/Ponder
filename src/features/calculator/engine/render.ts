import { BLINK_OFF, BLINK_ON, OVER_OFF, OVER_ON, type MNode, baseless, cells, isEmptySlot, measure, parse, serialize } from "../lcd/layout";
import { type State, MODE_ROWS, fmtOf, menuTabs, modeSelected, tableRows } from "./calc";
import { isEmpty, markup } from "./editor";
import { formatFit, formatPlain } from "./format";
import { menuRows } from "./menus";

/** LCD text area: 96 dots (16 cells) wide, 32 dot rows of text (UI-SPEC §3.2). */
export const LCD_W = 96;
export const TEXT_H = 32;
/** An entry and its result share a row when together they take at most this many cells (BEHAVIOR §3.2). */
export const ROW_CELLS = 14;
const CELLS = 16;

export interface Row {
  l: string;
  r?: string;
  /** A horizontally scrolled entry: `l` is its text, `m` the whole line drawn `shift` dots to the left under `◂`. */
  m?: string;
  shift?: number;
}

export interface Model {
  /** rows: normal font; menu: 4×5 menu font in 6-dot rows; msg: centred message rows; grid: data editor / table. */
  kind: "rows" | "menu" | "msg" | "grid";
  rows: Row[];
  ind: string[];
  /** Grid screens: number of columns in the cell rows (data editor 3, table 2). */
  cols?: number;
  /** Dots cut off the top row of a scrolled Home screen. */
  cut?: number;
}

const stripMarks = (s: string) => s.replace(/[\uE000-\uE006]/g, "");
const width = (m: string) => measure(m).w;
const rowBox = (r: Row) => {
  const a = measure(r.m ?? (r.l || " "));
  const b = r.r !== undefined ? measure(r.r) : a;
  const asc = Math.max(a.h - 1, b.h - 1);
  return { h: Math.max(a.h, b.h), asc };
};

/** Remove superscripts from markup (they are cut off at the top of the screen). */
function stripSup(m: string): string {
  let out = "";
  for (let i = 0; i < m.length; i++) {
    if (m.startsWith("^{", i)) {
      let depth = 1;
      i += 2;
      while (i < m.length && depth) {
        if (m[i] === "{") depth++;
        if (m[i] === "}") depth--;
        i++;
      }
      i--;
      continue;
    }
    out += m[i];
  }
  return out;
}

function modeInd(s: State): string[] {
  const out: string[] = [];
  if (s.second) out.push("2ND");
  if (s.hyp) out.push("HYP");
  if (s.modes.fix != null) out.push("FIX");
  if (s.k) out.push("K");
  if (s.modes.notation !== "NORM") out.push(s.modes.notation);
  out.push(s.modes.angle);
  return out;
}

/** Function names and `ans` are tokens: a token that crosses a cut stays whole. */
function tokenEnds(ns: MNode[]): number[] {
  const flat = ns.map((n) => (n.t !== "g" ? "." : /^[A-Za-z]$/.test(n.key) ? n.key : n.key === "(" ? "(" : n.key === "⁻¹" ? "~" : "."));
  const ends = ns.map((_, i) => i + 1);
  for (const m of flat.join("").matchAll(/[A-Za-z]{2,}~?\(?/g))
    for (let i = m.index; i < m.index + m[0].length; i++) ends[i] = m.index + m[0].length;
  return ends;
}

/** Cut a history row at the 16th cell, also inside a superscript, and mark it with ▸ (BEHAVIOR §3.2). */
function cutRight(m: string): string {
  let budget = CELLS - 1;
  const take = (ns: MNode[]): string => {
    const ends = tokenEnds(ns);
    let out = "";
    for (let i = 0; i < ns.length; i++) {
      const n = ns[i];
      if (budget <= 0) break;
      if (n.t === "sup") {
        out += `^{${take(n.a)}}`;
        continue;
      }
      if (n.t === "g") {
        const e = ends[i];
        out += serialize(ns.slice(i, e));
        budget -= e - i;
        i = e - 1;
        continue;
      }
      const c = cells([n]);
      if (c > budget) {
        budget = 0;
        break;
      }
      budget -= c;
      out += serialize([n]);
    }
    return out;
  };
  return take(parse(m)) + "▸";
}

const hasCursor = (n: MNode): boolean =>
  n.t === "cur" || ("a" in n && (n.a.some(hasCursor) || (n.t === "frac" && n.b.some(hasCursor)) || (n.t === "root" && n.i.some(hasCursor))));

/** The slot of a template that holds the cursor. */
function cursorSlot(n: MNode): MNode[] | undefined {
  if (n.t === "frac") return n.a.some(hasCursor) ? n.a : n.b;
  if (n.t === "root") return n.i.some(hasCursor) ? n.i : n.a;
  return "a" in n ? n.a : undefined;
}

/** Cells the cursor needs after the last item when it sits at the very end (one more inside a superscript). */
function endCost(ns: MNode[]): number {
  const last = ns[ns.length - 1];
  if (!last) return 0;
  switch (last.t) {
    case "cur":
      return 1;
    case "sup": {
      // an empty slot holding the cursor is one cell, already counted
      if (last.a.length && isEmptySlot(last.a)) return 1;
      const c = endCost(last.a);
      return c && c + 1;
    }
    case "sqrt":
    case "root":
      return endCost(last.a);
    case "frac":
      return endCost(last.a) || endCost(last.b);
    default:
      return 0;
  }
}

/** Scroll window when the cursor has moved left of it: whole tokens are kept from the left edge (BEHAVIOR §3.2). */
function scrollLeft(m: string): string {
  let nodes = parse(m);
  if (cells(nodes) <= CELLS - 2) return m;
  // a template wider than the screen scrolls by its content: descend to the slot that holds the cursor
  let hidden = 0;
  let overline = false;
  for (;;) {
    const at = nodes.findIndex(hasCursor);
    const n = nodes[at];
    const slot = n && n.t !== "cur" && cells([n]) > CELLS - 2 ? cursorSlot(n) : undefined;
    if (!slot) break;
    hidden += cells(nodes.slice(0, at)) + (n.t === "sqrt" || (n.t === "root" && slot === n.a) ? 1 : 0);
    overline ||= n.t === "sqrt" || (n.t === "root" && slot === n.a);
    nodes = slot;
  }
  const items: { n: MNode | null; w: number }[] = nodes.map((n, i) => ({
    n,
    w: n.t === "cur" ? (nodes[i + 1]?.t === "frac" && nodes[i - 1]?.t === "g" ? 1 : 0) : cells([n]),
  }));
  items[items.length - 1].w += endCost(nodes);
  const total = hidden + items.reduce((a, it) => a + it.w, 0);
  const over = (t: string) => (overline ? OVER_ON + t + OVER_OFF : t);
  if (total <= CELLS) return (hidden ? "◂" : "") + over(serialize(nodes));
  if (hidden) items.unshift({ n: null, w: hidden });
  const cur = Math.max(0, items.findIndex((it) => it.n && hasCursor(it.n)));
  const window = (start: number) => {
    let used = start > 0 ? 1 : 0;
    let i = start;
    for (; i < items.length; i++) {
      const tail = items.slice(i + 1).some((it) => it.w > 0) ? 1 : 0;
      if (used + items[i].w + tail > CELLS) break;
      used += items[i].w;
    }
    return i;
  };
  let start = hidden ? 1 : 0;
  while (window(start) <= cur && start < items.length - 1) start++;
  // a cursor item too wide for the window is still shown
  const stop = Math.max(window(start), cur + 1);
  const rest = items.slice(stop).some((it) => it.w > 0);
  // a radical scrolled partly off screen keeps its overline over the visible content
  return (start > 0 ? "◂" : "") + over(serialize(items.slice(start, stop).map((it) => it.n!))) + (rest ? "▸" : "");
}

const PITCH = 6;
const subNodes = (n: MNode): MNode[][] =>
  n.t === "frac" ? [n.a, n.b] : n.t === "root" ? [n.i, n.a] : "a" in n ? [n.a] : [];

const endsWithFrac = (ns: MNode[]): boolean => {
  const last = ns.filter((n) => n.t !== "cur").pop();
  if (!last) return false;
  if (last.t === "frac") return true;
  return (last.t === "sqrt" || last.t === "root" || last.t === "sup") && endsWithFrac(last.a);
};

/** Dot positions of every node of an entry line; a cursor at the end of a slot or in an empty slot takes a cell there. */
function place(nodes: MNode[]) {
  const pos = new Map<MNode, { x: number; w: number }>();
  let cur: { node: MNode; slot: boolean } | undefined;
  const shiftAll = (ns: MNode[], dx: number) => {
    for (const n of ns) {
      pos.get(n)!.x += dx;
      subNodes(n).forEach((c) => shiftAll(c, dx));
    }
  };
  const seq = (ns: MNode[], x0: number, slot: boolean): number => {
    let x = x0;
    ns.forEach((n, i) => {
      const w = one(n, x, slot, ns[i - 1], ns[i + 1]);
      pos.set(n, { x, w });
      x += w;
    });
    return x - x0;
  };
  const slotW = (ns: MNode[], x0: number): number => {
    if (isEmptySlot(ns)) {
      seq(ns, x0, true);
      return PITCH;
    }
    const base = baseless(ns) ? PITCH : 0;
    return base + seq(ns, x0 + base, true) + (ns[ns.length - 1].t === "cur" ? PITCH : 0);
  };
  const one = (n: MNode, x: number, slot: boolean, prev?: MNode, next?: MNode): number => {
    switch (n.t) {
      case "g":
      case "base":
        return PITCH;
      case "cur":
        // in front of a stacked fraction the cursor is in a mixed number's whole-part slot
        cur = { node: n, slot: slot || next?.t === "frac" };
        return next?.t === "frac" && prev?.t === "g" ? PITCH : 0;
      case "sup":
        return slotW(n.a, x);
      case "frac": {
        const wa = slotW(n.a, x + PITCH / 2);
        const wb = slotW(n.b, x + PITCH / 2);
        const inner = Math.max(wa, wb, PITCH);
        shiftAll(n.a, Math.floor((inner - wa) / 2));
        shiftAll(n.b, Math.floor((inner - wb) / 2));
        return inner + PITCH;
      }
      case "sqrt":
        return PITCH + slotW(n.a, x + PITCH);
      case "root": {
        const wi = slotW(n.i, x);
        return wi + PITCH + slotW(n.a, x + wi + PITCH);
      }
      default:
        return seq(n.a, x, slot);
    }
  };
  const w = seq(nodes, 1, false);
  return { pos, w, cur: cur && { x: pos.get(cur.node)!.x, slot: cur.slot } };
}

/** Horizontal scroll of the entry being typed (BEHAVIOR §3.2): the shift in dots is recomputed after every key
 * from the line width and the cursor position. */
function scrollEntry(m: string): Row {
  const nodes = parse(m);
  const { pos, w, cur } = place(nodes);
  // an empty fraction at the end that does not hold the cursor gives way to ▸
  const last = nodes[nodes.length - 1];
  const dropLast = last?.t === "frac" && !last.a.length && !last.b.length;
  const width = dropLast ? pos.get(last)!.x - 1 : w;
  const content = width + (!dropLast && endsWithFrac(nodes) ? 0 : PITCH) - LCD_W;
  const limit = cur?.slot ? 88 : 91;
  const back = cur?.slot ? 85 : 91;
  const shift = Math.max(content, cur && cur.x > limit ? cur.x - back : 0, 0);
  if (!shift) return { l: m };
  const first = shift + 1 + PITCH;
  if (cur && cur.x < first) return { l: scrollLeft(m) };
  const fits = (n: MNode) => pos.get(n)!.x + pos.get(n)!.w - shift <= LCD_W + 1;
  const seen = (n: MNode) => {
    const p = pos.get(n)!;
    if (!fits(n)) return false;
    return n.t === "g" ? p.x >= first : n.t !== "cur" && n.t !== "base" && p.x + p.w > first;
  };
  // glyphs under ◂ (cell 0) are not written; a template cut on the left keeps its wrapper
  const enc = (ns: MNode[]): string =>
    ns
      .filter(seen)
      .map((n) => {
        switch (n.t) {
          case "g":
            return n.key;
          case "sup":
            return `^{${enc(n.a)}}`;
          case "frac":
            return `\\f{${enc(n.a)}}{${enc(n.b)}}`;
          case "sqrt":
            return `√{${enc(n.a)}}`;
          case "root":
            return `\\r{${enc(n.i)}}{${enc(n.a)}}`;
          case "inv":
            return `«${enc(n.a)}»`;
          default:
            return "a" in n ? enc(n.a) : "";
        }
      })
      .join("");
  // a row whose visible glyphs are all in one superscript is written flat
  const owners = new Set<MNode | null>();
  const own = (ns: MNode[], sup: MNode | null) =>
    ns.filter(seen).forEach((n) => {
      if (n.t === "g") owners.add(sup);
      else subNodes(n).forEach((c) => own(c, sup ?? (n.t === "sup" ? n : null)));
    });
  own(nodes, null);
  const [sole] = owners;
  const text = owners.size === 1 && sole?.t === "sup" ? enc(sole.a) : enc(nodes);
  return { l: "◂" + text + (nodes.every(fits) ? "" : "▸"), m, shift };
}

const contains = (ns: MNode[], t: MNode["t"]): boolean =>
  ns.some((n) => {
    if (n.t === t) return true;
    if (n.t === "frac") return contains(n.a, t) || contains(n.b, t);
    if (n.t === "root") return contains(n.i, t) || contains(n.a, t);
    return "a" in n && contains(n.a, t);
  });

/** Exceptions to the cell rule: a radical inside a stacked-fraction result, or a fraction nested in a fraction. */
function ownRow(em: string, rm: string): boolean {
  const inFrac = (ns: MNode[], t: MNode["t"]) => ns.some((n) => n.t === "frac" && (contains(n.a, t) || contains(n.b, t)));
  const e = parse(em);
  return (inFrac(parse(rm), "sqrt") && !contains(e, "frac")) || inFrac(e, "frac");
}

function homeModel(s: State): Model {
  const rows: Row[] = [];
  const browsing = s.browse !== null;
  const first = browsing ? 0 : s.start;
  const n = s.history.length;
  let selRow = -1;
  for (let j = first; j < n; j++) {
    const h = s.history[j];
    const back = n - 1 - j;
    const selE = browsing && s.browse === back * 2 + 1;
    const selR = browsing && s.browse === back * 2;
    const em = selE ? `«${h.em}»` : h.em;
    const rm = selR ? `«${h.rm}»` : h.rm;
    if (selE) selRow = rows.length;
    if (!h.rm) {
      rows.push({ l: width(em) > LCD_W ? cutRight(em) : em });
      continue;
    }
    if (width(em) > LCD_W) {
      rows.push({ l: cutRight(em) });
      if (selR) selRow = rows.length;
      rows.push({ l: "", r: rm });
    } else if (cells(parse(em)) + cells(parse(rm)) <= ROW_CELLS && !ownRow(h.em, h.rm)) {
      if (selR) selRow = rows.length;
      rows.push({ l: em, r: rm });
    } else {
      rows.push({ l: em });
      if (selR) selRow = rows.length;
      rows.push({ l: "", r: rm });
    }
  }
  if (!isEmpty(s.ed)) rows.push(scrollEntry(markup(s.ed.els, s.modes.mathprint, s.ed)));

  const boxes = rows.map(rowBox);
  const tops: number[] = [];
  let y = 0;
  for (const b of boxes) {
    tops.push(y);
    y += b.h;
  }
  let viewTop = Math.max(0, y - TEXT_H);
  if (selRow >= 0 && tops[selRow] < viewTop) viewTop = tops[selRow];
  const out: Row[] = [];
  let cut = 0;
  rows.forEach((r, i) => {
    const top = tops[i];
    const bottom = top + boxes[i].h;
    if (bottom <= viewTop || top >= viewTop + TEXT_H) return;
    if (top >= viewTop) return void out.push(r);
    const c = viewTop - top;
    if (c > boxes[i].asc - 7) return;
    const piece = (m: string) => (/\\f\{/.test(m) ? "" : stripSup(m));
    const l = piece(r.l);
    const rr = r.r !== undefined ? piece(r.r) : undefined;
    if (!l && !rr) return;
    if (!out.length) cut = c;
    out.push({ l, r: rr });
  });

  const ind = modeInd(s);
  const atOldest = browsing && s.browse === n * 2 - 1;
  if (n > 0 && !atOldest) ind.push("↑");
  if (browsing || (n > 0 && isEmpty(s.ed) && s.start < n && s.done)) ind.push("↓");
  return { kind: "rows", rows: out, ind, cut };
}

function blinkWrap(text: string, on: boolean) {
  return on ? BLINK_ON + text + BLINK_OFF : text;
}

export function model(s: State): Model {
  const sc = s.screen;
  const fmt = fmtOf(s);
  const mp = s.modes.mathprint;
  switch (sc.t) {
    case "off":
      return { kind: "rows", rows: [], ind: [] };
    case "cleared":
      return { kind: "msg", rows: [{ l: "" }, { l: "MEMORY CLEARED" }], ind: modeInd(s) };
    case "error":
      return { kind: "msg", rows: [{ l: "" }, { l: sc.msg }, { l: "Error" }], ind: modeInd(s) };
    case "menu": {
      const tabs = menuTabs(s, sc.id);
      return { kind: "rows", rows: menuRows(tabs, sc.tab, sc.sel, sc.top).map((l) => ({ l })), ind: modeInd(s) };
    }
    case "mode": {
      const sel = modeSelected(s.modes);
      const rows = MODE_ROWS.map((choices, r) => {
        const parts = choices.map((c, i) => blinkWrap(i === sel[r] ? `«${c}»` : c, r === sc.row && i === sc.col));
        return { l: r === 2 ? `${parts[0]} ${parts.slice(1).join("")}` : parts.join(" ") };
      });
      return { kind: "menu", rows, ind: modeInd(s) };
    }
    case "home":
      return homeModel(s);
    case "k":
      return { kind: "rows", rows: [{ l: "K=" + markup(s.kEd.els, mp, s.kEd) }], ind: modeInd(s) };
    case "kdone":
      return { kind: "rows", rows: [{ l: "K=" + markup(s.k ?? [], mp) }], ind: modeInd(s) };
    case "data": {
      const rows: Row[] = [];
      for (let r = sc.top; r < sc.top + 4; r++) {
        const cs = s.lists.map((l, c) => {
          const t = r < l.length ? cellText(l[r], fmt) : r === l.length ? "------" : "";
          return c === sc.col && r === sc.row ? `«${t}»` : t;
        });
        if (cs.some((c) => c)) rows.push({ l: cs.join("|") });
      }
      const label = `L${sc.col + 1}(${sc.row + 1})=`;
      let line: string;
      if (sc.formula) line = `♦L${sc.col + 1}=` + markup(sc.ed?.els ?? [], mp, sc.ed ?? undefined);
      else {
        const l = s.lists[sc.col];
        const val = sc.ed ? markup(sc.ed.els, mp, sc.ed) : sc.row < l.length ? formatPlain(l[sc.row], fmt) : "";
        line = (s.formulas[sc.col] ? `«${label}»` : label) + val;
      }
      rows.push({ l: line });
      return { kind: "grid", cols: 3, rows, ind: ["L1", "L2", "L3", ...modeInd(s)] };
    }
    case "statSetup": {
      const c = s.statCfg;
      const pick = (row: number, opts: string[], selIdx: number) =>
        opts.map((o, i) => blinkWrap(i === selIdx ? `«${o}»` : o, sc.row === row && sc.col === i)).join(" ");
      const L = ["L1", "L2", "L3"];
      const rows =
        sc.kind === 1
          ? [{ l: "1-VAR STATS" }, { l: "DATA: " + pick(0, L, c.data) }, { l: "FRQ: " + pick(1, ["ONE", ...L], c.frq) }]
          : [{ l: "2-VAR STATS" }, { l: "xDATA: " + pick(0, L, c.x) }, { l: "yDATA: " + pick(1, L, c.y) }];
      rows.push({ l: "" }, { l: blinkWrap("CALC", sc.row === 2) });
      return { kind: "menu", rows, ind: modeInd(s) };
    }
    case "tableFn":
      return { kind: "rows", rows: [{ l: "y=" + markup(s.table.fn.els, mp, s.table.fn) }], ind: modeInd(s) };
    case "tableSetup": {
      const t = s.table;
      const field = (ed: typeof t.start, row: number) => markup(ed.els, mp, sc.row === row ? ed : undefined);
      const choice = (i: number, label: string) => blinkWrap((t.auto ? 0 : 1) === i ? `«${label}»` : label, sc.row === 2 && sc.col === i);
      return {
        kind: "rows",
        rows: [
          { l: "Start=" + field(t.start, 0) },
          { l: "Step=" + field(t.step, 1) },
          { l: `${choice(0, "Auto")}  ${choice(1, "Ask-x")}` },
          { l: "", r: blinkWrap("OK", sc.row === 3) },
        ],
        ind: modeInd(s),
      };
    }
    case "table": {
      const data = tableRows(s, sc);
      const rows: Row[] = [{ l: "x|y" }];
      const inv = (t: string, on: boolean) => (on ? `«${t}»` : t);
      data.forEach((d, i) => {
        const on = sc.top + i === sc.sel;
        rows.push({ l: `${inv(cellText(d.x, fmt), on && sc.col === 0)}|${inv(d.y, on && sc.col === 1)}` });
      });
      if (!data.length) rows.push({ l: "«»|" });
      let bottom: string;
      if (sc.ed && !isEmpty(sc.ed)) bottom = "x=" + markup(sc.ed.els, mp, sc.ed);
      else {
        const sel = data[sc.sel - sc.top];
        bottom = sc.col === 1 ? "y=" + (sel?.yFull ?? "") : "x=" + (sel ? formatPlain(sel.x, fmt) : "");
      }
      rows.push({ l: bottom });
      return { kind: "grid", cols: 2, rows, ind: modeInd(s) };
    }
  }
}

function cellText(v: { d: number; q?: { n: number; m: number; r: number; pi: number } }, fmt: ReturnType<typeof fmtOf>) {
  if (v.q && v.q.r === 1 && v.q.pi === 0 && v.q.m !== 1) return formatPlain(v, fmt);
  return formatFit(v.d, fmt, 6);
}

/** The test-hook text (BEHAVIOR §2). */
export function text(s: State): { lines: string[]; indicators: string[] } {
  const m = model(s);
  const lines = m.rows
    .map((r) => stripMarks(r.r !== undefined ? `${r.l}\t${r.r}` : r.l).replace(/ +$/, ""));
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return { lines, indicators: m.ind };
}
