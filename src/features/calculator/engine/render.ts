import { BLINK_OFF, BLINK_ON, CUR, CUR_INS, cells, measure, parse, parseItems } from "../lcd/layout";
import { type State, MODE_ROWS, fmtOf, menuTabs, modeSelected, tableRows } from "./calc";
import { isEmpty, markup } from "./editor";
import { formatFit, formatPlain } from "./format";
import { menuRows } from "./menus";

/** LCD text area: 96 dots wide, 34 dot rows below the indicator band. */
export const LCD_W = 96;
export const TEXT_H = 34;
/** An entry and its result share a row when together they take at most this many cells (BEHAVIOR §3.2). */
export const ROW_CELLS = 14;
const MARK_W = 6;

export interface Row {
  l: string;
  r?: string;
}

export interface Model {
  kind: "rows" | "msg" | "grid";
  rows: Row[];
  ind: string[];
  /** Grid screens: number of columns in the cell rows (data editor 3, table 2). */
  cols?: number;
}

const stripMarks = (s: string) => s.replace(/[\uE000-\uE003]/g, "");
const width = (m: string) => measure(m).w;
const height = (r: Row) => Math.max(measure(r.l || " ").h, r.r !== undefined ? measure(r.r).h : 0);

function modeInd(s: State): string[] {
  const out: string[] = [];
  if (s.second) out.push("2ND");
  if (s.hyp) out.push("HYP");
  if (s.k) out.push("K");
  if (s.modes.notation !== "NORM") out.push(s.modes.notation);
  if (s.modes.fix != null) out.push("FIX");
  out.push(s.modes.angle);
  return out;
}

/** Cut a row that is wider than the LCD at item boundaries and add the ▸ overflow mark. */
function cutRight(m: string): string {
  const items = parseItems(m);
  let w = 0;
  let out = "";
  for (const it of items) {
    const iw = width(it.src || " ");
    if (w + iw > LCD_W - MARK_W) break;
    w += iw;
    out += it.src;
  }
  return out + "▸";
}

/** Horizontal scroll of the entry being typed so the cursor stays visible. */
function scrollEntry(m: string): string {
  if (width(m) <= LCD_W) return m;
  const items = parseItems(m).filter((it) => it.src);
  const ws = items.map((it) => (it.src === CUR || it.src === CUR_INS ? 0 : width(it.src)));
  const cur = Math.max(0, items.findIndex((it) => it.src.includes(CUR) || it.src.includes(CUR_INS)));
  let start = 0;
  const fits = (a: number) => {
    let w = a > 0 ? MARK_W : 0;
    let i = a;
    for (; i < items.length; i++) {
      const tail = i < items.length - 1 ? MARK_W : 0;
      if (w + ws[i] + tail > LCD_W) break;
      w += ws[i];
    }
    return i;
  };
  while (fits(start) <= cur && start < items.length - 1) start++;
  const stop = fits(start);
  return (start > 0 ? "◂" : "") + items.slice(start, stop).map((it) => it.src).join("") + (stop < items.length ? "▸" : "");
}

function homeModel(s: State): Model {
  const fmt = fmtOf(s);
  void fmt;
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
    const we = width(em);
    if (we > LCD_W) {
      rows.push({ l: cutRight(em) });
      if (selR) selRow = rows.length;
      rows.push({ l: "", r: rm });
    } else if (cells(parse(em), true) + cells(parse(rm), false) <= ROW_CELLS) {
      if (selR) selRow = rows.length;
      rows.push({ l: em, r: rm });
    } else {
      rows.push({ l: em });
      if (selR) selRow = rows.length;
      rows.push({ l: "", r: rm });
    }
  }
  if (!isEmpty(s.ed)) rows.push({ l: scrollEntry(markup(s.ed.els, s.modes.mathprint, s.ed)) });
  const hs = rows.map(height);
  let startRow = rows.length;
  let total = 0;
  while (startRow > 0 && total + hs[startRow - 1] <= TEXT_H) total += hs[--startRow];
  let endRow = rows.length;
  if (selRow >= 0 && selRow < startRow) {
    startRow = selRow;
    total = 0;
    endRow = startRow;
    while (endRow < rows.length && total + hs[endRow] <= TEXT_H) total += hs[endRow++];
  }
  const hidden = startRow > 0;
  const ind = modeInd(s);
  if (n > 0) ind.push("↑");
  if (browsing || (s.pasted && !isEmpty(s.ed)) || (hidden && isEmpty(s.ed))) ind.push("↓");
  return { kind: "rows", rows: rows.slice(startRow, endRow), ind };
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
      return { kind: "msg", rows: [{ l: "MEMORY CLEARED" }], ind: modeInd(s) };
    case "error":
      return { kind: "msg", rows: [{ l: sc.msg }], ind: modeInd(s) };
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
      return { kind: "rows", rows, ind: modeInd(s) };
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
        const cells = s.lists.map((l, c) => {
          const t = r < l.length ? cellText(l[r], fmt) : r === l.length ? "------" : "";
          return c === sc.col && r === sc.row ? `«${t}»` : t;
        });
        rows.push({ l: cells.join("|") });
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
          ? [
              { l: "1-VAR STATS" },
              { l: "DATA: " + pick(0, L, c.data) },
              { l: "FRQ: " + pick(1, ["ONE", ...L], c.frq) },
              { l: "", r: blinkWrap("CALC", sc.row === 2) },
            ]
          : [
              { l: "2-VAR STATS" },
              { l: "xDATA: " + pick(0, L, c.x) },
              { l: "yDATA: " + pick(1, L, c.y) },
              { l: "", r: blinkWrap("CALC", sc.row === 2) },
            ];
      return { kind: "rows", rows, ind: modeInd(s) };
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
          { l: `${choice(0, "Auto")} ${choice(1, "Ask-x")}` },
          { l: "", r: blinkWrap("OK", sc.row === 3) },
        ],
        ind: modeInd(s),
      };
    }
    case "table": {
      const data = tableRows(s, sc);
      const rows: Row[] = [{ l: "x|y" }];
      data.forEach((d, i) => {
        const xt = cellText(d.x, fmt);
        rows.push({ l: `${sc.top + i === sc.sel ? `«${xt}»` : xt}|${d.y}` });
      });
      let bottom: string;
      if (sc.ed && !isEmpty(sc.ed)) bottom = "x=" + markup(sc.ed.els, mp, sc.ed);
      else {
        const selX = data[sc.sel - sc.top]?.x;
        bottom = "x=" + (selX ? formatPlain(selX, fmt) : "");
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
  const lines = m.rows.map((r) => stripMarks(r.r !== undefined ? `${r.l}\t${r.r}` : r.l).replace(/ +$/, ""));
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  return { lines, indicators: m.ind };
}
