import { buildCurve, yRange, type Curve } from "../../../lib/plot/curves";
import { evaluate, type AngleMode } from "../../../lib/plot/parser";
import { niceStep } from "../../../lib/plot/ticks";

export const COLS = 16;
export const ROWS = 8;
export const FN_COUNT = 6;
export const TABLE_ROWS = 6;
/** Width over height of the plot area. */
export const PLOT_ASPECT = 1.5;
/** Cursor steps across the window while tracing. */
export const TRACE_STEPS = 120;

export type Screen = "home" | "yeq" | "window" | "zoom" | "graph" | "trace" | "table" | "tblset";

export interface Edit {
  text: string;
  cur: number;
}

export interface HomeLine {
  input: string;
  output: string;
  error: boolean;
}

export interface Win {
  xmin: number;
  xmax: number;
  xscl: number;
  ymin: number;
  ymax: number;
  yscl: number;
}

export const WINDOW_FIELDS = ["xmin", "xmax", "xscl", "ymin", "ymax", "yscl"] as const;
export const ZOOM_ITEMS = ["standard", "zoomIn", "zoomOut", "trig", "fit", "square"] as const;

export interface ClassicState {
  screen: Screen;
  second: boolean;
  angle: AngleMode;
  home: { history: HomeLine[]; edit: Edit; ans: number };
  yeq: { fns: string[]; row: number; cur: number };
  win: Win;
  winEdit: { row: number; edit: Edit; fresh: boolean };
  zoomSel: number;
  trace: { fn: number; x: number; jump: Edit | null };
  table: { start: number; step: number; top: number };
  tblset: { row: number; edit: Edit; fresh: boolean };
  message: string | null;
}

export const STANDARD: Win = { xmin: -10, xmax: 10, xscl: 1, ymin: -10, ymax: 10, yscl: 1 };

export function initial(): ClassicState {
  return {
    screen: "home",
    second: false,
    angle: "rad",
    home: { history: [], edit: { text: "", cur: 0 }, ans: 0 },
    yeq: { fns: Array(FN_COUNT).fill(""), row: 0, cur: 0 },
    win: { ...STANDARD },
    winEdit: { row: 0, edit: { text: fmt(STANDARD.xmin), cur: 0 }, fresh: true },
    zoomSel: 0,
    trace: { fn: 0, x: 0, jump: null },
    table: { start: 0, step: 1, top: 0 },
    tblset: { row: 0, edit: { text: "0", cur: 0 }, fresh: true },
    message: null,
  };
}

export function fmt(v: number): string {
  if (!Number.isFinite(v)) return "ERR";
  if (v === 0) return "0";
  const a = Math.abs(v);
  if (a >= 1e10 || a < 1e-4) return v.toExponential(9).replace(/\.?0+e/, "e").replace("e+", "E").replace("e", "E");
  return String(Number(v.toPrecision(10)));
}

/** The most precise form of v that fits in `width` characters. */
export function fit(v: number, width: number): string {
  for (let p = 10; p >= 1; p--) {
    const t = fmt(Number(v.toPrecision(p)));
    if (t.length <= width) return t;
  }
  for (let p = 9; p >= 0; p--) {
    const t = v.toExponential(p).replace(/\.?0+e/, "e").replace("e+", "E").replace("e", "E");
    if (t.length <= width) return t;
  }
  return fmt(v).slice(0, width);
}

const CHARS: Record<string, string> = {
  "0": "0",
  "1": "1",
  "2": "2",
  "3": "3",
  "4": "4",
  "5": "5",
  "6": "6",
  "7": "7",
  "8": "8",
  "9": "9",
  ".": ".",
  add: "+",
  sub: "-",
  mul: "*",
  div: "/",
  pow: "^",
  lparen: "(",
  rparen: ")",
  x: "X",
  sin: "sin(",
  cos: "cos(",
  tan: "tan(",
  square: "^2",
  sqrt: "sqrt(",
  log: "log(",
  ln: "ln(",
  pi: "pi",
  ans: "ans",
  neg: "-",
};

/** Text typed by a key after 2nd. */
export const SECOND_CHARS: Record<string, { label: string; text: string }> = {
  sin: { label: "sin⁻¹", text: "asin(" },
  cos: { label: "cos⁻¹", text: "acos(" },
  tan: { label: "tan⁻¹", text: "atan(" },
  log: { label: "10ˣ", text: "10^(" },
  ln: { label: "eˣ", text: "e^(" },
  square: { label: "x⁻¹", text: "^(-1)" },
  sqrt: { label: "|x|", text: "abs(" },
  lparen: { label: "⌊ ⌋", text: "floor(" },
  rparen: { label: "⌈ ⌉", text: "ceil(" },
  pi: { label: "e", text: "e" },
  enter: { label: "entry", text: "" },
};

export const charFor = (key: string, second: boolean): string | null => (second ? SECOND_CHARS[key]?.text || null : null) ?? CHARS[key] ?? null;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const ins = (e: Edit, t: string): Edit => ({ text: e.text.slice(0, e.cur) + t + e.text.slice(e.cur), cur: e.cur + t.length });
const back = (e: Edit): Edit => (e.cur ? { text: e.text.slice(0, e.cur - 1) + e.text.slice(e.cur), cur: e.cur - 1 } : e);
const move = (e: Edit, d: number): Edit => ({ ...e, cur: clamp(e.cur + d, 0, e.text.length) });
const end = (text: string): Edit => ({ text, cur: text.length });

/** Apply a typed key to an edit buffer; null if the key is not an editing key. */
function editKey(e: Edit, key: string, second: boolean): Edit | null {
  const ch = charFor(key, second);
  if (ch) return ins(e, ch);
  if (key === "del") return back(e);
  if (key === "left") return move(e, -1);
  if (key === "right") return move(e, 1);
  return null;
}

export function errorText(v: number): string {
  if (Number.isNaN(v)) return "ERR:DOMAIN";
  return "ERR:DIVIDE BY 0";
}

function calc(text: string, angle: AngleMode, ans: number): { ok: true; value: number } | { ok: false; msg: string } {
  const r = evaluate(text, angle, { ans });
  if (!r.ok) return { ok: false, msg: "ERR:SYNTAX" };
  if (!Number.isFinite(r.value)) return { ok: false, msg: errorText(r.value) };
  return { ok: true, value: Math.abs(r.value) < 1e-14 ? 0 : r.value };
}

export interface ClassicFn {
  index: number;
  curve: Extract<Curve, { kind: "y" }>;
}

/** Rows with text that parse, in order. Rows that do not parse are reported by `badRow`. */
export function enabledFns(st: Pick<ClassicState, "yeq" | "angle">): ClassicFn[] {
  const out: ClassicFn[] = [];
  st.yeq.fns.forEach((t, index) => {
    if (!t.trim() || t.includes("=")) return;
    const curve = buildCurve(t, st.angle);
    if (curve.kind === "y") out.push({ index, curve });
  });
  return out;
}

export function badRow(st: Pick<ClassicState, "yeq" | "angle">): number {
  return st.yeq.fns.findIndex((t) => t.trim() !== "" && (t.includes("=") || buildCurve(t, st.angle).kind !== "y"));
}

function windowError(w: Win): string | null {
  if (!(w.xmin < w.xmax) || !(w.ymin < w.ymax) || !(w.xscl > 0) || !(w.yscl > 0)) return "ERR:WINDOW RANGE";
  return null;
}

export const tableX = (t: { start: number; step: number }, n: number) => Number((t.start + n * t.step).toPrecision(12));

export function fnValue(f: ClassicFn, x: number): number {
  return f.curve.f(x);
}

function goTo(st: ClassicState, screen: Screen): ClassicState {
  const next: ClassicState = { ...st, screen, message: null };
  if (screen === "window") next.winEdit = { row: 0, edit: { text: fmt(st.win.xmin), cur: 0 }, fresh: true };
  if (screen === "tblset") next.tblset = { row: 0, edit: { text: fmt(st.table.start), cur: 0 }, fresh: true };
  if (screen === "yeq") next.yeq = { ...st.yeq, cur: st.yeq.fns[st.yeq.row].length };
  if (screen === "zoom") next.zoomSel = 0;
  return next;
}

const NAV: Record<string, Screen> = { yeq: "yeq", window: "window", zoom: "zoom", graph: "graph", trace: "trace", table: "table", setup: "tblset" };

/** Number fields on WINDOW and the table setup screen share this commit step. */
function commitField(edit: Edit): { ok: true; value: number } | { ok: false } {
  const r = evaluate(edit.text, "rad");
  return r.ok && Number.isFinite(r.value) ? { ok: true, value: r.value } : { ok: false };
}

function commitWindow(st: ClassicState): ClassicState | null {
  const c = commitField(st.winEdit.edit);
  if (!c.ok) return null;
  const field = WINDOW_FIELDS[st.winEdit.row];
  return { ...st, win: { ...st.win, [field]: c.value } };
}

function loadWinRow(st: ClassicState, row: number): ClassicState {
  return { ...st, winEdit: { row, edit: { text: fmt(st.win[WINDOW_FIELDS[row]]), cur: 0 }, fresh: true } };
}

function commitTblset(st: ClassicState): ClassicState | null {
  const c = commitField(st.tblset.edit);
  if (!c.ok) return null;
  const table = { ...st.table, [st.tblset.row === 0 ? "start" : "step"]: c.value, top: 0 };
  if (table.step === 0) return null;
  return { ...st, table };
}

function applyZoom(st: ClassicState, item: (typeof ZOOM_ITEMS)[number]): ClassicState {
  const w = st.win;
  const cx = (w.xmin + w.xmax) / 2;
  const cy = (w.ymin + w.ymax) / 2;
  let win: Win = w;
  switch (item) {
    case "standard":
      win = { ...STANDARD };
      break;
    case "zoomIn":
    case "zoomOut": {
      const f = item === "zoomIn" ? 0.5 : 2;
      win = { ...w, xmin: cx - ((w.xmax - w.xmin) / 2) * f, xmax: cx + ((w.xmax - w.xmin) / 2) * f, ymin: cy - ((w.ymax - w.ymin) / 2) * f, ymax: cy + ((w.ymax - w.ymin) / 2) * f };
      break;
    }
    case "trig":
      win = st.angle === "deg" ? { xmin: -360, xmax: 360, xscl: 90, ymin: -4, ymax: 4, yscl: 1 } : { xmin: -2 * Math.PI, xmax: 2 * Math.PI, xscl: Math.PI / 2, ymin: -4, ymax: 4, yscl: 1 };
      break;
    case "fit": {
      const r = yRange(enabledFns(st).map((f) => f.curve), w.xmin, w.xmax);
      if (r) {
        const pad = (r.ymax - r.ymin) * 0.1 || 1;
        const ymin = r.ymin - pad;
        const ymax = r.ymax + pad;
        win = { ...w, ymin, ymax, yscl: niceStep((ymax - ymin) / 10) };
      }
      break;
    }
    case "square": {
      const half = ((w.ymax - w.ymin) / 2) * PLOT_ASPECT;
      win = { ...w, xmin: cx - half, xmax: cx + half };
      break;
    }
  }
  return { ...st, win, screen: "graph", message: null };
}

function enterTrace(st: ClassicState): ClassicState {
  const fns = enabledFns(st);
  if (!fns.length) return { ...st, screen: "graph", message: "ERR:NO FUNCTION" };
  const bad = windowError(st.win);
  if (bad) return { ...st, screen: "window", message: bad };
  return { ...st, screen: "trace", message: null, trace: { fn: 0, x: (st.win.xmin + st.win.xmax) / 2, jump: null } };
}

function enterGraph(st: ClassicState): ClassicState {
  const bad = badRow(st);
  if (bad >= 0) return { ...st, screen: "yeq", message: `ERR:SYNTAX Y${bad + 1}`, yeq: { ...st.yeq, row: bad, cur: st.yeq.fns[bad].length } };
  const w = windowError(st.win);
  if (w) return { ...st, screen: "window", message: w };
  return { ...st, screen: "graph", message: null };
}

function navigate(st: ClassicState, target: Screen): ClassicState {
  if (st.screen === "window") {
    const c = commitWindow(st);
    if (!c) return { ...st, message: "ERR:SYNTAX" };
    st = c;
  }
  if (st.screen === "tblset") {
    const c = commitTblset(st);
    if (!c) return { ...st, message: "ERR:INVALID" };
    st = c;
  }
  if (target === "graph") return enterGraph(st);
  if (target === "trace") {
    const g = enterGraph(st);
    return g.screen === "graph" ? enterTrace(g) : g;
  }
  return goTo(st, target);
}

export function press(st: ClassicState, key: string): ClassicState {
  if (key === "2nd") return { ...st, second: !st.second, message: null };
  const second = st.second;
  const base: ClassicState = { ...st, second: false };
  if (key === "mode") return { ...base, angle: st.angle === "rad" ? "deg" : "rad", message: null };
  if (NAV[key]) return navigate(base, NAV[key]);
  switch (st.screen) {
    case "home":
      return homeKey(base, key, second);
    case "yeq":
      return yeqKey(base, key, second);
    case "window":
      return windowKey(base, key, second);
    case "zoom":
      return zoomKey(base, key);
    case "graph":
      return key === "clear" ? goTo(base, "home") : { ...base, message: null };
    case "trace":
      return traceKey(base, key, second);
    case "table":
      return tableKey(base, key);
    case "tblset":
      return tblsetKey(base, key, second);
  }
}

function homeKey(st: ClassicState, key: string, second: boolean): ClassicState {
  const h = st.home;
  if (key === "enter" && second) {
    const last = [...h.history].reverse().find((l) => l.input);
    return last ? { ...st, home: { ...h, edit: end(last.input) }, message: null } : st;
  }
  if (key === "up") {
    const last = h.history.at(-1);
    return last && !h.edit.text ? { ...st, home: { ...h, edit: end(last.input) } } : st;
  }
  if (key === "clear") return h.edit.text ? { ...st, home: { ...h, edit: { text: "", cur: 0 } } } : { ...st, home: { ...h, history: [] } };
  if (key === "enter") {
    const text = h.edit.text.trim();
    if (!text) return st;
    const r = calc(text, st.angle, h.ans);
    const history = [...h.history, { input: text, output: r.ok ? fmt(r.value) : r.msg, error: !r.ok }].slice(-50);
    return r.ok ? { ...st, home: { history, edit: { text: "", cur: 0 }, ans: r.value } } : { ...st, home: { ...h, history } };
  }
  const e = editKey(h.edit, key, second);
  return e ? { ...st, home: { ...h, edit: e } } : st;
}

function yeqKey(st: ClassicState, key: string, second: boolean): ClassicState {
  const y = st.yeq;
  const setRow = (row: number): ClassicState => ({ ...st, message: null, yeq: { ...y, row, cur: y.fns[row].length } });
  if (key === "up") return setRow(clamp(y.row - 1, 0, FN_COUNT - 1));
  if (key === "down" || key === "enter") return setRow(clamp(y.row + 1, 0, FN_COUNT - 1));
  const cur: Edit = { text: y.fns[y.row], cur: y.cur };
  const put = (e: Edit): ClassicState => ({ ...st, message: null, yeq: { ...y, fns: y.fns.map((t, i) => (i === y.row ? e.text : t)), cur: e.cur } });
  if (key === "clear") return put({ text: "", cur: 0 });
  const e = editKey(cur, key, second);
  return e ? put(e) : st;
}

function windowKey(st: ClassicState, key: string, second: boolean): ClassicState {
  const w = st.winEdit;
  const go = (row: number): ClassicState => {
    const c = commitWindow(st);
    if (!c) return { ...st, message: "ERR:SYNTAX" };
    return loadWinRow({ ...c, message: null }, clamp(row, 0, WINDOW_FIELDS.length - 1));
  };
  if (key === "up") return go(w.row - 1);
  if (key === "down" || key === "enter") return go(w.row + 1);
  if (key === "clear") return { ...st, message: null, winEdit: { ...w, edit: { text: "", cur: 0 }, fresh: false } };
  const base = w.fresh && charFor(key, second) ? { text: "", cur: 0 } : w.edit;
  const e = editKey(base, key, second);
  if (!e) return st;
  return { ...st, message: null, winEdit: { ...w, edit: e, fresh: false } };
}

function zoomKey(st: ClassicState, key: string): ClassicState {
  const n = ZOOM_ITEMS.length;
  if (key === "up") return { ...st, zoomSel: (st.zoomSel + n - 1) % n };
  if (key === "down") return { ...st, zoomSel: (st.zoomSel + 1) % n };
  if (key === "enter") return applyZoom(st, ZOOM_ITEMS[st.zoomSel]);
  if (key === "clear") return goTo(st, "home");
  const d = Number(key);
  if (Number.isInteger(d) && d >= 1 && d <= n) return applyZoom(st, ZOOM_ITEMS[d - 1]);
  return st;
}

function traceKey(st: ClassicState, key: string, second: boolean): ClassicState {
  const t = st.trace;
  const w = st.win;
  const fns = enabledFns(st);
  if (!fns.length) return { ...st, screen: "graph" };
  const step = (w.xmax - w.xmin) / TRACE_STEPS;
  if (key === "left" || key === "right") return { ...st, message: null, trace: { ...t, jump: null, x: clamp(t.x + (key === "left" ? -step : step), w.xmin, w.xmax) } };
  if (key === "up" || key === "down") return { ...st, message: null, trace: { ...t, fn: (t.fn + (key === "up" ? fns.length - 1 : 1)) % fns.length } };
  if (key === "clear") return { ...st, screen: "graph", message: null, trace: { ...t, jump: null } };
  if (key === "enter") {
    if (!t.jump) return st;
    const c = commitField(t.jump);
    if (!c.ok || c.value < w.xmin || c.value > w.xmax) return { ...st, message: "ERR:INVALID", trace: { ...t, jump: null } };
    return { ...st, message: null, trace: { ...t, x: c.value, jump: null } };
  }
  const e = editKey(t.jump ?? { text: "", cur: 0 }, key, second);
  return e ? { ...st, message: null, trace: { ...t, jump: e.text ? e : null } } : st;
}

function tableKey(st: ClassicState, key: string): ClassicState {
  if (key === "up") return { ...st, table: { ...st.table, top: st.table.top - 1 } };
  if (key === "down") return { ...st, table: { ...st.table, top: st.table.top + 1 } };
  if (key === "clear") return goTo(st, "home");
  return st;
}

function tblsetKey(st: ClassicState, key: string, second: boolean): ClassicState {
  const t = st.tblset;
  const go = (row: number): ClassicState => {
    const c = commitTblset(st);
    if (!c) return { ...st, message: "ERR:INVALID" };
    const r = clamp(row, 0, 1);
    const value = r === 0 ? c.table.start : c.table.step;
    return { ...c, message: null, tblset: { row: r, edit: { text: fmt(value), cur: 0 }, fresh: true } };
  };
  if (key === "up") return go(t.row - 1);
  if (key === "down" || key === "enter") return go(t.row + 1);
  if (key === "clear") return { ...st, message: null, tblset: { ...t, edit: { text: "", cur: 0 }, fresh: false } };
  const base = t.fresh && charFor(key, second) ? { text: "", cur: 0 } : t.edit;
  const e = editKey(base, key, second);
  return e ? { ...st, message: null, tblset: { ...t, edit: e, fresh: false } } : st;
}

export interface LcdText {
  lines: string[];
  /** Cursor cell (row, col) when the screen is editing. */
  cursor: { row: number; col: number } | null;
}

const pad = (s: string, n = COLS) => (s.length > n ? s.slice(0, n) : s.padEnd(n));
const right = (s: string) => s.padStart(COLS).slice(-COLS);

function wrap(text: string): string[] {
  if (!text) return [""];
  const out: string[] = [];
  for (let i = 0; i < text.length; i += COLS) out.push(text.slice(i, i + COLS));
  return out;
}

const WINDOW_LABELS: Record<(typeof WINDOW_FIELDS)[number], string> = { xmin: "Xmin", xmax: "Xmax", xscl: "Xscl", ymin: "Ymin", ymax: "Ymax", yscl: "Yscl" };
const ZOOM_LABELS: Record<(typeof ZOOM_ITEMS)[number], string> = { standard: "Standard", zoomIn: "Zoom in", zoomOut: "Zoom out", trig: "Trig", fit: "Fit", square: "Square" };

/** What the 16 by 8 text display shows for the non-graph screens. */
export function screenText(st: ClassicState): LcdText {
  const rows: string[] = [];
  let cursor: LcdText["cursor"] = null;
  const fill = () => {
    while (rows.length < ROWS) rows.push("");
  };
  const msg = () => {
    if (st.message) rows[ROWS - 1] = st.message;
  };

  if (st.screen === "home") {
    const { edit, history } = st.home;
    const body = history.flatMap((l) => [...wrap(l.input), right(l.output)]);
    const atWrap = edit.text.length > 0 && edit.text.length % COLS === 0 && edit.cur === edit.text.length;
    const editRows = atWrap ? [...wrap(edit.text), ""] : wrap(edit.text);
    const all = [...body, ...editRows];
    const visible = all.slice(-ROWS);
    const editStart = body.length - (all.length - visible.length);
    cursor = { row: Math.max(0, Math.min(ROWS - 1, editStart + Math.floor(edit.cur / COLS))), col: edit.cur % COLS };
    return { lines: [...visible, ...Array(ROWS - visible.length).fill("")].map((r) => pad(r)), cursor };
  }

  if (st.screen === "yeq") {
    const avail = COLS - 3;
    const { fns, row, cur: c } = st.yeq;
    const from = Math.max(0, c - avail + 1);
    fns.forEach((t, i) => rows.push(`Y${i + 1}=${i === row ? t.slice(from) : t}`));
    cursor = { row, col: 3 + c - from };
    fill();
    msg();
  } else if (st.screen === "window") {
    WINDOW_FIELDS.forEach((f, i) => {
      const cur = i === st.winEdit.row;
      rows.push(`${WINDOW_LABELS[f]}=${cur ? st.winEdit.edit.text : fmt(st.win[f])}`);
    });
    cursor = { row: st.winEdit.row, col: Math.min(COLS - 1, 5 + st.winEdit.edit.cur) };
    fill();
    msg();
  } else if (st.screen === "zoom") {
    rows.push("ZOOM");
    ZOOM_ITEMS.forEach((z, i) => rows.push(`${i === st.zoomSel ? ">" : " "}${i + 1}:${ZOOM_LABELS[z]}`));
    fill();
  } else if (st.screen === "tblset") {
    rows.push("TABLE SETUP", `Start=${st.tblset.row === 0 ? st.tblset.edit.text : fmt(st.table.start)}`, `Step=${st.tblset.row === 1 ? st.tblset.edit.text : fmt(st.table.step)}`);
    cursor = { row: 1 + st.tblset.row, col: Math.min(COLS - 1, 6 + st.tblset.edit.cur) };
    fill();
    msg();
  } else if (st.screen === "table") {
    const fns = enabledFns(st).slice(0, 2);
    const colW = fns.length === 2 ? 5 : 10;
    rows.push(` X   ${fns.map((f) => `Y${f.index + 1}`.padStart(colW)).join("")}`);
    for (let r = 0; r < TABLE_ROWS; r++) {
      const x = tableX(st.table, st.table.top + r);
      const cells = fns.map((f) => {
        const y = fnValue(f, x);
        return (Number.isFinite(y) ? fit(y, colW - 1) : "ERROR").padStart(colW);
      });
      rows.push(` ${fit(x, 4).padEnd(4)}${cells.join("")}`);
    }
    rows.push(fns.length ? "" : "No function");
  } else {
    fill();
    msg();
  }
  return { lines: rows.map((r) => pad(r)), cursor };
}

export interface TraceReadout {
  label: string;
  x: number;
  y: number;
  jump: string | null;
}

export function traceReadout(st: ClassicState): TraceReadout | null {
  if (st.screen !== "trace") return null;
  const fns = enabledFns(st);
  const f = fns[st.trace.fn];
  if (!f) return null;
  return { label: `Y${f.index + 1}`, x: st.trace.x, y: fnValue(f, st.trace.x), jump: st.trace.jump?.text ?? null };
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

export function serialize(st: ClassicState): string {
  return JSON.stringify({ angle: st.angle, home: { history: st.home.history, ans: st.home.ans }, fns: st.yeq.fns, win: st.win, table: { start: st.table.start, step: st.table.step } });
}

/** Rebuild a state from `serialize` output; anything malformed falls back to the defaults. */
export function restore(raw: string | null): ClassicState {
  const st = initial();
  if (!raw) return st;
  try {
    const p = JSON.parse(raw);
    if (p.angle === "deg") st.angle = "deg";
    if (Array.isArray(p.home?.history)) {
      st.home.history = p.home.history
        .filter((l: HomeLine) => typeof l?.input === "string" && typeof l?.output === "string")
        .slice(-50)
        .map((l: HomeLine) => ({ input: l.input, output: l.output, error: l.error === true }));
    }
    if (isNum(p.home?.ans)) st.home.ans = p.home.ans;
    if (Array.isArray(p.fns) && p.fns.length === FN_COUNT && p.fns.every((t: unknown) => typeof t === "string")) st.yeq.fns = p.fns;
    if (WINDOW_FIELDS.every((f) => isNum(p.win?.[f]))) st.win = Object.fromEntries(WINDOW_FIELDS.map((f) => [f, p.win[f]])) as unknown as Win;
    if (isNum(p.table?.start) && isNum(p.table?.step) && p.table.step !== 0) st.table = { start: p.table.start, step: p.table.step, top: 0 };
  } catch {
    return initial();
  }
  return st;
}
