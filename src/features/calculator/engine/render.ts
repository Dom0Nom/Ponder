import { BLINK_OFF, BLINK_ON, CUR, CUR_INS, type MNode, cells, measure, parse, serialize } from "../lcd/layout";
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

const stripMarks = (s: string) => s.replace(/[-]/g, "");
const width = (m: string) => measure(m).w;
const rowBox = (r: Row) => {
  const a = measure(r.l || " ");
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

/** Cut a history row at the 16th cell, also inside a superscript, and mark it with ▸ (BEHAVIOR §3.2). */
function cutRight(m: string): string {
  let budget = CELLS - 1;
  const take = (ns: MNode[]): string => {
    let out = "";
    for (const n of ns) {
      if (budget <= 0) break;
      if (n.t === "sup") {
        out += `^{${take(n.a)}}`;
        continue;
      }
      const c = n.t === "g" ? 1 : cells([n]);
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

/** Horizontal scroll of the entry being typed: the cursor keeps a cell of its own (BEHAVIOR §3.2). */
function scrollEntry(m: string): string {
  const nodes = parse(m);
  const endsWithCursor = (ns: MNode[]): boolean => {
    const last = ns[ns.length - 1];
    if (!last) return false;
    if (last.t === "cur") return true;
    if (last.t === "sup" || last.t === "sqrt") return endsWithCursor(last.a);
    if (last.t === "frac") return endsWithCursor(last.a) || endsWithCursor(last.b);
    if (last.t === "root") return endsWithCursor(last.a);
    return false;
  };
  const hasCursor = (n: MNode): boolean =>
    n.t === "cur" || ("a" in n && (n.a.some(hasCursor) || (n.t === "frac" && n.b.some(hasCursor)) || (n.t === "root" && n.i.some(hasCursor))));
  const items = nodes.map((n) => ({ n, w: n.t === "cur" ? 0 : cells([n]) }));
  const endsInToken = /[a-z]{2,}(⁻¹)?\(?$/.test(m.split(CUR).join("").split(CUR_INS).join(""));
  if (endsWithCursor(nodes) && !endsInToken) items[items.length - 1].w += 1;
  const total = items.reduce((a, it) => a + it.w, 0);
  if (total <= CELLS) return m;
  const cur = Math.max(0, items.findIndex((it) => hasCursor(it.n)));
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
  let start = 0;
  while (window(start) <= cur && start < items.length - 1) start++;
  const stop = window(start);
  const rest = items.slice(stop).some((it) => it.w > 0);
  return (start > 0 ? "◂" : "") + serialize(items.slice(start, stop).map((it) => it.n)) + (rest ? "▸" : "");
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
  if (!isEmpty(s.ed)) rows.push({ l: scrollEntry(markup(s.ed.els, s.modes.mathprint, s.ed)) });

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
