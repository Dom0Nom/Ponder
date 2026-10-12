import {
  type Ed,
  type El,
  VARS,
  clearFrom,
  clone,
  del,
  end,
  fromMarkup,
  home,
  insert,
  isEmpty,
  isTok,
  left,
  listAt,
  markup,
  newEd,
  prevEl,
  right,
  takeIndex,
  takeOperand,
  tok,
  tpl,
  vertical,
  wrapPower,
} from "./editor";
import { type Angle, type Ctx, type StatVals, run } from "./expr";
import { type Fmt, type Notation, formatFit, formatSig10, formatPlain, formatResult, fullDecimal, isDecimalText, toggled } from "./format";
import { type MenuAction, type MenuId, type MenuItem, type MenuTab, STATIC_MENUS, STAT_ITEMS_1, STAT_ITEMS_2 } from "./menus";
import * as N from "./num";
import { CalcError, type ErrCode, type Val, int, ZERO } from "./num";
import { oneVar, twoVar } from "./stats";

export interface Modes {
  angle: Angle;
  notation: Notation;
  fix: number | null;
  mathprint: boolean;
}

export interface Hist {
  entry: El[];
  em: string;
  rm: string;
  val: Val;
  exact: boolean;
}

export type Screen =
  | { t: "home" }
  | { t: "off" }
  | { t: "cleared" }
  | { t: "error"; msg: ErrCode; back: Screen }
  | { t: "menu"; id: MenuId; tab: number; sel: number; top: number; back: Screen }
  | { t: "mode"; row: number; col: number }
  | { t: "data"; col: number; row: number; top: number; ed: Ed | null; formula: boolean }
  | { t: "statSetup"; kind: 1 | 2; row: number; col: number }
  | { t: "tableFn" }
  | { t: "tableSetup"; row: number; col: number; fresh: boolean }
  | { t: "table"; sel: number; top: number; col: number; ed: Ed | null }
  | { t: "k" }
  | { t: "kdone" };

export interface StatResult {
  kind: 1 | 2;
  title: string;
  vals: StatVals;
}

export interface State {
  modes: Modes;
  second: boolean;
  hyp: boolean;
  screen: Screen;
  ed: Ed;
  lastKey: string;
  history: Hist[];
  start: number;
  browse: number | null;
  pasted: boolean;
  /** A calculation just finished and nothing was typed since (lights ↓). */
  done: boolean;
  ans: Val;
  vars: Record<string, Val>;
  seed: number;
  k: El[] | null;
  kEd: Ed;
  lists: Val[][];
  formulas: (El[] | null)[];
  stat: StatResult | null;
  statCfg: { data: number; frq: number; x: number; y: number };
  /** Screen that statistics return to: Home, or the data editor they were started from. */
  statBack: Screen;
  table: { fn: Ed; start: Ed; step: Ed; auto: boolean; xs: Val[] };
}

export const KEYS = [
  "2nd", "mode", "delete", "up", "down", "left", "right", "log", "prb", "data", "ln", "frac", "x10n", "table",
  "clear", "pi", "sin", "cos", "tan", "div", "pow", "recip", "lparen", "rparen", "mul", "square", "7", "8", "9",
  "sub", "var", "4", "5", "6", "add", "sto", "1", "2", "3", "toggle", "on", "0", ".", "neg", "enter",
] as const;
export type Key = (typeof KEYS)[number];

const RAND_M = 2147483563;
const RAND_A = 40014;

export function initialState(): State {
  return {
    modes: { angle: "DEG", notation: "NORM", fix: null, mathprint: true },
    second: false,
    hyp: false,
    screen: { t: "home" },
    ed: newEd(),
    lastKey: "",
    history: [],
    start: 0,
    browse: null,
    pasted: false,
    done: false,
    ans: ZERO,
    vars: Object.fromEntries(VARS.map((v) => [v, ZERO])),
    seed: 12345,
    k: null,
    kEd: newEd(),
    lists: [[], [], []],
    formulas: [null, null, null],
    stat: null,
    statCfg: { data: 0, frq: 0, x: 0, y: 1 },
    statBack: { t: "home" },
    table: { fn: newEd(), start: newEd([tok("0")]), step: newEd([tok("1")]), auto: true, xs: [] },
  };
}

const fmtOf = (s: State): Fmt => ({ notation: s.modes.notation, fix: s.modes.fix, mathprint: s.modes.mathprint });

function nextRand(s: State): number {
  s.seed = (RAND_A * s.seed) % RAND_M;
  return s.seed / RAND_M;
}

function ctxOf(s: State, extra: Partial<Ctx> = {}): Ctx {
  return {
    angle: s.modes.angle,
    vars: s.vars,
    ans: s.ans,
    stat: s.stat?.vals ?? null,
    rand: () => nextRand(s),
    lists: s.lists,
    ...extra,
  };
}

const TRIG = new Set(["sin", "cos", "tan", "2nd+sin", "2nd+cos", "2nd+tan"]);
const ANS_FIRST = new Set(["add", "sub", "mul", "div", "pow", "square", "recip", "sto", "2nd+lparen", "x10n"]);
const VALUE_FIRST = new Set(["2nd+rparen", "2nd+x10n", "2nd+table"]);

/** Keys shared by every entry line (Home, K, table function, data editor, setup fields). */
function editKey(s: State, ed: Ed, k: string, implicitAns: boolean): boolean {
  const mp = s.modes.mathprint;
  if (implicitAns && isEmpty(ed) && ANS_FIRST.has(k)) insert(ed, [tok("ans")]);
  if (implicitAns && isEmpty(ed) && VALUE_FIRST.has(k)) insert(ed, ansValue(s));
  const put = (v: string) => insert(ed, [tok(v)]);
  if (/^[0-9.]$/.test(k)) {
    put(k);
    return true;
  }
  const simple: Record<string, string> = {
    add: "+",
    sub: "-",
    mul: "*",
    div: "÷",
    neg: "⁻",
    lparen: "(",
    rparen: ")",
    pi: "π",
    log: "log(",
    ln: "ln(",
    "2nd+.": ",",
    "2nd+neg": "ans",
    "2nd+lparen": "%",
    "2nd+rparen": "▸%",
    "2nd+x10n": "▸n/d◂▸Un/d",
    "2nd+table": "▸F◂▸d",
  };
  if (simple[k]) {
    put(simple[k]);
    return true;
  }
  if (TRIG.has(k)) {
    const inv = k.startsWith("2nd+");
    const base = inv ? k.slice(4) : k;
    put(`${base}${s.hyp ? "h" : ""}${inv ? "⁻¹" : ""}(`);
    s.hyp = false;
    return true;
  }
  switch (k) {
    case "sto":
      put("→");
      return true;
    case "2nd+log":
      if (mp) insert(ed, [tok("1"), tok("0"), tpl("pow", [])], { at: 2, slot: 0 });
      else put("10^(");
      return true;
    case "2nd+ln":
      if (mp) insert(ed, [tok("e"), tpl("pow", [])], { at: 1, slot: 0 });
      else put("e^(");
      return true;
    case "pow":
      if (mp) {
        wrapPower(ed);
        insert(ed, [tpl("pow", [])], { at: 0, slot: 0 });
      } else put("^");
      return true;
    case "2nd+pow":
      if (mp) {
        const idx = isEmpty(ed) ? [tok("ans")] : takeIndex(ed);
        insert(ed, [tpl("root", idx, [])], { at: 0, slot: idx.length ? 1 : 0 });
      } else put("ˣ√");
      return true;
    case "square":
      if (mp) {
        wrapPower(ed);
        insert(ed, [tpl("pow", [tok("2")])]);
      } else put("²");
      return true;
    case "recip":
      if (mp) {
        wrapPower(ed);
        insert(ed, [tpl("pow", [tok("⁻"), tok("1")])]);
      } else put("⁻¹");
      return true;
    case "2nd+square":
      if (mp) insert(ed, [tpl("sqrt", [])], { at: 0, slot: 0 });
      else put("√(");
      return true;
    case "frac":
      if (mp) {
        const num = takeOperand(ed);
        insert(ed, [tpl("frac", num, [])], { at: 0, slot: num.length ? 1 : 0 });
      } else put("⁄");
      return true;
    case "2nd+frac":
      if (mp) {
        const w = takeOperand(ed);
        insert(ed, [tpl("mixed", w, [], [])], { at: 0, slot: w.length ? 1 : 0 });
      } else put("␣");
      return true;
    case "x10n":
      if (mp) insert(ed, [tok("*"), tok("1"), tok("0"), tpl("pow", [])], { at: 3, slot: 0 });
      else insert(ed, [tok("*"), tok("1"), tok("0"), tok("^")]);
      return true;
    case "var": {
      const p = prevEl(ed);
      if (s.lastKey === "var" && isTok(p) && VARS.includes(p.v)) {
        listAt(ed)[ed.pos - 1] = tok(VARS[(VARS.indexOf(p.v) + 1) % VARS.length]);
      } else put("x");
      return true;
    }
    case "delete":
      del(ed);
      return true;
    case "2nd+delete":
      ed.ins = true;
      return true;
    case "left":
      ed.ins = false;
      left(ed);
      return true;
    case "right":
      ed.ins = false;
      right(ed);
      return true;
    case "2nd+left":
      ed.ins = false;
      home(ed);
      return true;
    case "2nd+right":
      ed.ins = false;
      end(ed);
      return true;
  }
  return false;
}

function pushHist(s: State, els: El[], val: Val, rm: string) {
  s.history.push({ entry: clone(els), em: markup(els, s.modes.mathprint), rm, val, exact: !isDecimalText(rm) });
  if (s.history.length > 60) {
    s.history.shift();
    s.start = Math.max(0, s.start - 1);
  }
}

function fail(s: State, e: unknown, back: Screen) {
  if (e instanceof CalcError) {
    s.screen = { t: "error", msg: e.code, back };
    return;
  }
  throw e;
}

function homeEnter(s: State) {
  let els: El[];
  if (s.k) els = [...(isEmpty(s.ed) ? [tok("ans")] : clone(s.ed.els)), ...clone(s.k)];
  else if (!isEmpty(s.ed)) els = clone(s.ed.els);
  else if (s.history.length) els = clone(s.history[s.history.length - 1].entry).filter((e) => !isTok(e, "◂▸"));
  else return;
  try {
    const r = run(els, ctxOf(s));
    if (r.store === "rand") s.seed = Math.abs(Math.trunc(r.val.d)) % RAND_M || 12345;
    else if (r.store) s.vars[r.store] = { d: r.val.d };
    const rm = formatResult(r.val, fmtOf(s), { hint: r.hint, usedFrac: r.usedFrac });
    pushHist(s, els, r.val, rm);
    s.ans = r.hint === "pct" ? { d: r.val.d * 100, q: undefined } : r.val;
    s.ed = newEd();
    s.pasted = false;
    s.done = true;
  } catch (e) {
    if (e instanceof CalcError) {
      s.history.push({ entry: clone(els), em: markup(els, s.modes.mathprint), rm: "", val: s.ans, exact: false });
      s.start = s.history.length;
      s.ed = newEd(clone(els));
      s.ed.pos = Math.min(e.pos ?? els.length, els.length);
      const power = s.ed.els[s.ed.pos - 1];
      if (e.inSlot && power?.k === "pow") {
        s.ed.path = [{ i: s.ed.pos - 1, s: 0 }];
        s.ed.pos = power.s[0].length;
      }
    }
    fail(s, e, { t: "home" });
  }
}

function toggle(s: State) {
  const last = s.history[s.history.length - 1];
  if (!last || !last.rm || !isEmpty(s.ed)) return;
  const em = last.exact ? last.rm : fullDecimal(last.val.d);
  const rm = toggled(last.val, last.rm, fmtOf(s));
  s.history.push({ entry: [...fromMarkup(em), tok("◂▸")], em: em + "◂▸", rm, val: last.val, exact: !isDecimalText(rm) });
  s.done = true;
}

function pasteParts(s: State): { els: El[] } | undefined {
  if (s.browse === null) return undefined;
  const item = s.history[s.history.length - 1 - Math.floor(s.browse / 2)];
  if (!item) return undefined;
  if (s.browse % 2 === 1) return { els: clone(item.entry).filter((e) => !isTok(e, "◂▸")) };
  return { els: fromMarkup(item.exact ? item.rm : fullDecimal(item.val.d)) };
}

function homeKey(s: State, k: string) {
  if (s.browse !== null) {
    const max = s.history.length * 2 - 1;
    if (k === "up") return void (s.browse = Math.min(s.browse + 1, max));
    if (k === "2nd+up") return void (s.browse = max);
    if (k === "down") return void (s.browse = s.browse > 0 ? s.browse - 1 : null);
    if (k === "2nd+down") return void (s.browse = null);
    if (k === "enter") {
      const p = pasteParts(s);
      s.browse = null;
      if (p) {
        insert(s.ed, p.els);
        s.pasted = true;
      }
      return;
    }
    s.browse = null;
    if (k === "clear") return;
  }
  switch (k) {
    case "enter":
      return homeEnter(s);
    case "clear":
      s.done = false;
      if (isEmpty(s.ed)) s.start = s.history.length;
      else if (!clearFrom(s.ed)) s.ed = newEd();
      s.pasted = false;
      return;
    case "toggle":
      if (isEmpty(s.ed) && s.history.at(-1)?.rm) return toggle(s);
      insert(s.ed, [tok("◂▸")]);
      s.done = false;
      return;
    case "up":
    case "2nd+up":
      if (vertical(s.ed, -1)) return;
      if (s.history.length) s.browse = k === "up" ? 0 : s.history.length * 2 - 1;
      return;
    case "down":
    case "2nd+down":
      vertical(s.ed, 1);
      return;
  }
  if (editKey(s, s.ed, k, true)) s.done = false;
}

/** Editor that menu picks and editing keys apply to, for a given screen. */
function edFor(s: State, sc: Screen): Ed | null {
  switch (sc.t) {
    case "home":
      return s.ed;
    case "k":
      return s.kEd;
    case "tableFn":
      return s.table.fn;
    case "data":
      if (!sc.ed) sc.ed = newEd(sc.formula ? clone(s.formulas[sc.col] ?? []) : []);
      return sc.ed;
    case "table":
      if (!sc.ed) sc.ed = newEd();
      return sc.ed;
    case "tableSetup":
      return sc.row === 0 ? s.table.start : sc.row === 1 ? s.table.step : null;
    default:
      return null;
  }
}

function menuTabs(s: State, id: MenuId): MenuTab[] {
  const st = STATIC_MENUS[id];
  if (st) return st;
  const fmt = fmtOf(s);
  if (id === "recall") {
    return [{ title: "Recall Var", items: VARS.map((v) => ({ label: `${v}=${formatPlain(s.vars[v], fmt)}`, act: { recall: v } })) }];
  }
  if (id === "stats") {
    const items: MenuItem[] = [
      { label: "1-Var Stats", act: { stats: 1 } },
      { label: "2-Var Stats", act: { stats: 2 } },
    ];
    if (s.stat) items.push({ label: "StatVars", act: { stats: 3 } });
    return [{ title: "STATS", items }];
  }
  const res = s.stat!;
  const names = res.kind === 1 ? STAT_ITEMS_1 : STAT_ITEMS_2;
  return [
    {
      title: res.title,
      items: names.map((n) => {
        if (n === "x'" || n === "y'") return { label: n, act: { statTok: `${n}(` } };
        const v = res.vals[n];
        return { label: `${n}=${v === "Error" ? "Error" : formatSig10(v, fmt)}`, act: { statTok: `stat:${n}` } };
      }),
    },
  ];
}

function openMenu(s: State, id: MenuId, back: Screen) {
  const sel = 0;
  s.screen = { t: "menu", id, tab: 0, sel, top: Math.max(0, sel - 2), back };
}

function doReset(s: State) {
  Object.assign(s, initialState());
  s.screen = { t: "cleared" };
}

/** The previous answer as entry elements: its exact form when it has one, else the 13-digit value. */
function ansValue(s: State): El[] {
  const v = s.ans;
  const exact = v.q ? formatResult(v, fmtOf(s), { hint: "exact" }) : "";
  return fromMarkup(exact && !/^[⁻0-9.]+$/.test(exact) ? exact : fullDecimal(v.d));
}

function insertTo(s: State, back: Screen, els: El[], ansFirst = false) {
  s.screen = back;
  const ed = edFor(s, back);
  if (!ed) return;
  if (ansFirst && (back.t === "home" || back.t === "data") && isEmpty(ed)) insert(ed, [tok("ans")]);
  insert(ed, els);
}

function runAction(s: State, act: MenuAction, sc: Extract<Screen, { t: "menu" }>) {
  const back = sc.back;
  if ("ins" in act) return insertTo(s, back, [tok(act.ins)], act.ansFirst);
  if ("dms" in act) {
    const ed = edFor(s, back);
    s.screen = back;
    if (ed && back.t === "home" && isEmpty(ed)) insert(ed, ansValue(s));
    if (ed) insert(ed, [tok("▸DMS")]);
    return;
  }
  if ("reset" in act) {
    if (act.reset) return doReset(s);
    s.screen = back;
    return;
  }
  if ("clearVars" in act) {
    if (act.clearVars) for (const v of VARS) s.vars[v] = ZERO;
    s.screen = back;
    return;
  }
  if ("recall" in act) {
    const v = s.vars[act.recall];
    const text = v.q && v.q.r === 1 && v.q.pi === 0 && v.q.m !== 1 ? formatResult(v, fmtOf(s), { hint: "exact" }) : fullDecimal(v.d);
    return insertTo(s, back, fromMarkup(text));
  }
  if ("stats" in act) {
    const n = act.stats as number;
    if (n === 3) return openMenu(s, "statvars", s.statBack);
    s.screen = { t: "statSetup", kind: n as 1 | 2, row: 0, col: n === 1 ? s.statCfg.data : s.statCfg.x };
    return;
  }
  if ("clearList" in act) {
    const idx = act.clearList < 0 ? [0, 1, 2] : [act.clearList];
    for (const i of idx) {
      s.lists[i] = [];
      s.formulas[i] = null;
    }
    s.screen = back;
    if (back.t === "data") back.row = Math.min(back.row, s.lists[back.col].length);
    return;
  }
  if ("formula" in act) {
    if (back.t !== "data") return;
    if (act.formula === "edit") {
      back.formula = true;
      back.ed = newEd(clone(s.formulas[back.col] ?? []));
    } else {
      const idx = act.formula < 0 ? [0, 1, 2] : [act.formula];
      for (const i of idx) s.formulas[i] = null;
    }
    s.screen = back;
    return;
  }
  if ("statTok" in act) return insertTo(s, s.statBack, [tok(act.statTok)]);
}

function menuKey(s: State, sc: Extract<Screen, { t: "menu" }>, k: string) {
  if (k === "data" && sc.id === "data" && sc.back.t === "data") {
    s.screen = { ...sc.back, row: 0, top: 0, ed: null };
    return;
  }
  const tabs = menuTabs(s, sc.id);
  const items = tabs[sc.tab].items;
  const fit = () => {
    if (sc.sel < sc.top) sc.top = sc.sel;
    if (sc.sel > sc.top + 2) sc.top = sc.sel - 2;
  };
  switch (k) {
    case "up":
      sc.sel = sc.sel > 0 ? sc.sel - 1 : items.length - 1;
      return fit();
    case "down":
      sc.sel = sc.sel < items.length - 1 ? sc.sel + 1 : 0;
      return fit();
    case "2nd+up":
      sc.sel = 0;
      return fit();
    case "2nd+down":
      sc.sel = items.length - 1;
      return fit();
    case "left":
    case "right":
      if (tabs.length > 1) {
        sc.tab = (sc.tab + (k === "right" ? 1 : tabs.length - 1)) % tabs.length;
        sc.sel = 0;
        sc.top = 0;
      }
      return;
    case "enter":
      return runAction(s, items[sc.sel].act, sc);
    case "clear":
      s.screen = sc.back;
      return;
  }
  if (/^[1-9]$/.test(k)) {
    const i = Number(k) - 1;
    if (i < items.length) {
      sc.sel = i;
      fit();
      runAction(s, items[i].act, sc);
    }
  }
}

const MODE_ROWS = [
  ["DEG", "RAD", "GRAD"],
  ["NORM", "SCI", "ENG"],
  ["FLOAT", "0", "1", "2", "3", "4", "5", "6", "7", "8", "9"],
  ["CLASSIC", "MATHPRINT"],
];

function modeSelected(m: Modes): number[] {
  return [
    ["DEG", "RAD", "GRAD"].indexOf(m.angle),
    ["NORM", "SCI", "ENG"].indexOf(m.notation),
    m.fix == null ? 0 : m.fix + 1,
    m.mathprint ? 1 : 0,
  ];
}

function modeKey(s: State, sc: Extract<Screen, { t: "mode" }>, k: string) {
  switch (k) {
    case "up":
      if (sc.row > 0) {
        sc.row--;
        sc.col = 0;
      }
      return;
    case "down":
      if (sc.row < 3) {
        sc.row++;
        sc.col = 0;
      }
      return;
    case "left":
      sc.col = Math.max(0, sc.col - 1);
      return;
    case "right":
      sc.col = Math.min(MODE_ROWS[sc.row].length - 1, sc.col + 1);
      return;
    case "enter": {
      const c = sc.col;
      if (sc.row === 0) s.modes.angle = MODE_ROWS[0][c] as Angle;
      if (sc.row === 1) s.modes.notation = MODE_ROWS[1][c] as Notation;
      if (sc.row === 2) s.modes.fix = c === 0 ? null : c - 1;
      if (sc.row === 3) s.modes.mathprint = c === 1;
      return;
    }
    case "clear":
    case "2nd+mode":
    case "mode":
      s.screen = { t: "home" };
  }
}

function recomputeFormulas(s: State) {
  s.formulas.forEach((f, i) => {
    if (!f) return;
    try {
      s.lists[i] = computeFormula(s, f, i);
    } catch {
      /* keep the previous values when a dependency changed shape */
    }
  });
}

function computeFormula(s: State, f: El[], own: number): Val[] {
  const refs = new Set<number>();
  const walk = (els: El[]) =>
    els.forEach((e) => {
      if (e.k === "t" && /^L[123]$/.test(e.v)) refs.add(Number(e.v[1]) - 1);
      if (e.k !== "t") e.s.forEach(walk);
    });
  walk(f);
  if (!refs.size || refs.has(own)) throw new CalcError("FORMULA");
  const lens = [...refs].map((i) => s.lists[i].length);
  if (lens.some((l) => l !== lens[0])) throw new CalcError("DIM MISMATCH");
  const out: Val[] = [];
  for (let i = 0; i < lens[0]; i++) {
    const r = run(f, ctxOf(s, { listIndex: i }));
    out.push(r.usedFrac && r.hint !== "fd" ? r.val : { d: r.val.d });
  }
  return out;
}

function dataCommit(s: State, sc: Extract<Screen, { t: "data" }>): boolean {
  if (!sc.ed) return true;
  const ed = sc.ed;
  if (sc.formula) {
    try {
      s.lists[sc.col] = computeFormula(s, ed.els, sc.col);
      s.formulas[sc.col] = clone(ed.els);
      sc.formula = false;
      sc.ed = null;
      sc.row = 0;
      sc.top = 0;
      return true;
    } catch (e) {
      fail(s, e, sc);
      return false;
    }
  }
  sc.ed = null;
  if (isEmpty(ed)) return true;
  try {
    const r = run(ed.els, ctxOf(s));
    const v = r.usedFrac ? r.val : { d: r.val.d };
    s.ans = r.val;
    const l = s.lists[sc.col];
    if (sc.row < l.length) l[sc.row] = v;
    else if (l.length < 42) l.push(v);
    s.formulas[sc.col] = null;
    recomputeFormulas(s);
    return true;
  } catch (e) {
    sc.ed = ed;
    fail(s, e, sc);
    return false;
  }
}

function dataKey(s: State, sc: Extract<Screen, { t: "data" }>, k: string) {
  const fitRow = () => {
    if (sc.row < sc.top) sc.top = sc.row;
    if (sc.row > sc.top + 3) sc.top = sc.row - 3;
  };
  const maxRow = () => Math.min(s.lists[sc.col].length, 41);
  if (sc.formula) {
    if (k === "data") return openMenu(s, "ls", sc);
    if (k === "enter") return void dataCommit(s, sc);
    if (k === "clear") {
      sc.ed = newEd();
      return;
    }
    if (k === "2nd+mode") return void (s.screen = { t: "home" });
    if (k === "up" || k === "down") return;
    editKey(s, sc.ed!, k, false);
    return;
  }
  switch (k) {
    case "enter":
    case "down":
      if (!dataCommit(s, sc)) return;
      sc.row = Math.min(sc.row + 1, maxRow());
      return fitRow();
    case "up":
      if (!dataCommit(s, sc)) return;
      sc.row = Math.max(0, sc.row - 1);
      return fitRow();
    case "2nd+up":
      if (!dataCommit(s, sc)) return;
      sc.row = 0;
      return fitRow();
    case "2nd+down":
      if (!dataCommit(s, sc)) return;
      sc.row = maxRow();
      return fitRow();
    case "left":
    case "right":
      if (!dataCommit(s, sc)) return;
      sc.col = Math.max(0, Math.min(2, sc.col + (k === "right" ? 1 : -1)));
      sc.row = Math.min(sc.row, maxRow());
      return fitRow();
    case "data":
      if (!dataCommit(s, sc)) return;
      return openMenu(s, "data", sc);
    case "2nd+data":
      if (!dataCommit(s, sc)) return;
      s.statBack = sc;
      return openMenu(s, "stats", sc);
    case "clear":
      sc.ed = newEd();
      return;
    case "delete":
      if (sc.ed) return void del(sc.ed);
      if (sc.row < s.lists[sc.col].length) {
        s.lists[sc.col].splice(sc.row, 1);
        s.formulas[sc.col] = null;
        recomputeFormulas(s);
      }
      return;
    case "2nd+mode":
    case "mode":
      s.screen = { t: "home" };
      return;
  }
  const ed = edFor(s, sc)!;
  editKey(s, ed, k, true);
}

function statKey(s: State, sc: Extract<Screen, { t: "statSetup" }>, k: string) {
  const cfg = s.statCfg;
  const choices = (row: number) => (sc.kind === 1 && row === 1 ? 4 : 3);
  const sel = (row: number) => (sc.kind === 1 ? (row === 0 ? cfg.data : cfg.frq) : row === 0 ? cfg.x : cfg.y);
  switch (k) {
    case "up":
      if (sc.row > 0) sc.row--;
      sc.col = sc.row < 2 ? sel(sc.row) : 0;
      return;
    case "down":
      if (sc.row < 2) sc.row++;
      sc.col = sc.row < 2 ? sel(sc.row) : 0;
      return;
    case "left":
    case "right":
      if (sc.row < 2) sc.col = Math.max(0, Math.min(choices(sc.row) - 1, sc.col + (k === "right" ? 1 : -1)));
      return;
    case "enter":
      if (sc.row < 2) {
        if (sc.kind === 1) {
          if (sc.row === 0) cfg.data = sc.col;
          else cfg.frq = sc.col;
        } else if (sc.row === 0) cfg.x = sc.col;
        else cfg.y = sc.col;
        sc.row++;
        sc.col = sc.row < 2 ? sel(sc.row) : 0;
        return;
      }
      return calcStats(s, sc.kind);
    case "clear":
      s.screen = s.statBack;
      return;
    case "2nd+mode":
      s.screen = { t: "home" };
  }
}

function calcStats(s: State, kind: 1 | 2) {
  const cfg = s.statCfg;
  const num = (l: Val[]) => l.map((v) => v.d);
  try {
    let vals: StatVals;
    let title: string;
    if (kind === 1) {
      const fs = cfg.frq === 0 ? null : num(s.lists[cfg.frq - 1]);
      vals = oneVar(num(s.lists[cfg.data]), fs);
      title = `1-Var:L${cfg.data + 1},${cfg.frq === 0 ? "1" : "L" + cfg.frq}`;
    } else {
      vals = twoVar(num(s.lists[cfg.x]), num(s.lists[cfg.y]));
      title = `2-Var:L${cfg.x + 1},L${cfg.y + 1}`;
    }
    s.stat = { kind, title, vals };
    openMenu(s, "statvars", s.statBack);
  } catch (e) {
    fail(s, e, s.statBack);
  }
}

function tableRows(s: State, sc: Extract<Screen, { t: "table" }>): { x: Val; y: string; yFull: string }[] {
  const fmt = fmtOf(s);
  const xs: Val[] = [];
  if (s.table.auto) {
    const start = evalOr(s, s.table.start.els, 0);
    const step = evalOr(s, s.table.step.els, 1);
    for (let i = sc.top; i < sc.top + 3; i++) xs.push(N.add(start, N.mul(int(i), step)));
  } else xs.push(...s.table.xs.slice(sc.top, sc.top + 3));
  return xs.map((x) => {
    let y: string;
    let yFull: string;
    try {
      const v = run(s.table.fn.els, ctxOf(s, { vars: { ...s.vars, x } })).val;
      y = formatFit(v.d, fmt, 6);
      yFull = formatPlain(v, fmt);
    } catch {
      y = yFull = "ERROR";
    }
    return { x, y, yFull };
  });
}

function evalOr(s: State, els: El[], dflt: number): Val {
  try {
    return els.length ? run(els, ctxOf(s)).val : int(dflt);
  } catch {
    return int(dflt);
  }
}

function tableKey(s: State, sc: Screen, k: string) {
  if (k === "2nd+mode") return void (s.screen = { t: "home" });
  if (sc.t === "tableFn") {
    if (k === "enter") {
      if (isEmpty(s.table.fn)) return;
      s.screen = { t: "tableSetup", row: 0, col: s.table.auto ? 0 : 1, fresh: true };
      home(s.table.start);
      return;
    }
    if (k === "clear") {
      if (isEmpty(s.table.fn)) s.screen = { t: "home" };
      else s.table.fn = newEd();
      return;
    }
    if (k === "table") return;
    editKey(s, s.table.fn, k, false);
    return;
  }
  if (sc.t === "tableSetup") {
    const enterRow = (r: number) => {
      sc.row = r;
      sc.fresh = true;
      if (r === 0) home(s.table.start);
      if (r === 1) home(s.table.step);
      if (r === 2) sc.col = s.table.auto ? 0 : 1;
    };
    switch (k) {
      case "down":
        return enterRow(Math.min(3, sc.row + 1));
      case "up":
        return enterRow(Math.max(0, sc.row - 1));
      case "left":
      case "right":
        if (sc.row === 2) sc.col = k === "right" ? 1 : 0;
        else if (sc.row < 2) editKey(s, edFor(s, sc)!, k, false);
        return;
      case "enter":
        if (sc.row === 2) {
          s.table.auto = sc.col === 0;
          return enterRow(3);
        }
        if (sc.row === 3) {
          const step = evalOr(s, s.table.step.els, 1);
          if (s.table.auto && step.d === 0) return fail(s, new CalcError("DOMAIN"), sc);
          s.table.xs = [];
          s.screen = { t: "table", sel: 0, top: 0, col: 0, ed: null };
          return;
        }
        return enterRow(sc.row + 1);
      case "clear":
        if (sc.row < 2) {
          const ed = edFor(s, sc)!;
          ed.els = [];
          ed.path = [];
          ed.pos = 0;
          sc.fresh = false;
        } else s.screen = { t: "tableFn" };
        return;
    }
    if (sc.row < 2) {
      const ed = edFor(s, sc)!;
      if (sc.fresh && ed.pos === 0) ed.ins = false;
      sc.fresh = false;
      editKey(s, ed, k, false);
    }
    return;
  }
  if (sc.t !== "table") return;
  if (k === "left" || k === "right") {
    sc.col = k === "right" ? 1 : 0;
    return;
  }
  if (s.table.auto) {
    switch (k) {
      case "down":
        sc.sel++;
        if (sc.sel > sc.top + 2) sc.top++;
        return;
      case "up":
        sc.sel--;
        if (sc.sel < sc.top) sc.top--;
        return;
      case "clear":
        s.screen = { t: "tableSetup", row: 0, col: 0, fresh: true };
        return;
    }
    return;
  }
  switch (k) {
    case "enter": {
      if (!sc.ed || isEmpty(sc.ed)) return;
      try {
        const x = run(sc.ed.els, ctxOf(s)).val;
        s.table.xs.push(x);
        sc.ed = null;
        sc.sel = s.table.xs.length - 1;
        sc.top = Math.max(0, sc.sel - 2);
      } catch (e) {
        fail(s, e, sc);
      }
      return;
    }
    case "down":
    case "up":
      sc.ed = null;
      sc.sel = Math.max(0, Math.min(s.table.xs.length - 1, sc.sel + (k === "down" ? 1 : -1)));
      if (sc.sel < sc.top) sc.top = sc.sel;
      if (sc.sel > sc.top + 2) sc.top = sc.sel - 2;
      return;
    case "clear":
      if (sc.ed && !isEmpty(sc.ed)) sc.ed = newEd();
      else s.screen = { t: "tableSetup", row: 0, col: 1, fresh: true };
      return;
  }
  editKey(s, edFor(s, sc)!, k, false);
}

/** One key press. Mutates `s`. */
export function press(s: State, key: string) {
  const sc = s.screen;
  if (sc.t === "off") {
    if (key === "on") {
      s.screen = { t: "home" };
      s.ed = newEd();
      s.start = s.history.length;
      s.browse = null;
    }
    return;
  }
  if (key === "2nd") {
    s.second = !s.second;
    return;
  }
  const k = s.second ? `2nd+${key}` : key;
  s.second = false;
  if (k !== "2nd+pi" && !TRIG.has(k)) s.hyp = false;
  try {
    dispatch(s, k);
  } finally {
    s.lastKey = k;
  }
}

function dispatch(s: State, k: string) {
  const sc = s.screen;
  if (k === "2nd+on") {
    s.screen = { t: "off" };
    return;
  }
  if (k === "2nd+pi") {
    s.hyp = !s.hyp;
    return;
  }
  if (sc.t === "cleared") {
    s.screen = { t: "home" };
    if (k === "clear") return;
    return dispatch(s, k);
  }
  if (sc.t === "kdone") {
    s.screen = { t: "home" };
    return dispatch(s, k);
  }
  if (sc.t === "error") {
    if (k === "clear") s.screen = sc.back;
    if (k === "2nd+mode") {
      s.screen = { t: "home" };
      s.ed = newEd();
    }
    return;
  }
  if (k === "2nd+0") return openMenu(s, "reset", sc.t === "menu" ? sc.back : sc);
  switch (sc.t) {
    case "menu":
      if (k === "2nd+mode") return void (s.screen = { t: "home" });
      return menuKey(s, sc, k);
    case "mode":
      return modeKey(s, sc, k);
    case "data":
      return dataKey(s, sc, k);
    case "statSetup":
      return statKey(s, sc, k);
    case "tableFn":
    case "tableSetup":
    case "table":
      return tableKey(s, sc, k);
    case "k":
      if (k === "enter") {
        s.k = isEmpty(s.kEd) ? null : clone(s.kEd.els);
        s.screen = s.k ? { t: "kdone" } : { t: "home" };
        return;
      }
      if (k === "clear") {
        if (isEmpty(s.kEd)) s.screen = { t: "home" };
        s.kEd = newEd();
        return;
      }
      if (k === "2nd+mode" || k === "2nd+div") return void (s.screen = { t: "home" });
      editKey(s, s.kEd, k, false);
      return;
  }
  switch (k) {
    case "mode":
      s.browse = null;
      s.screen = { t: "mode", row: 0, col: modeSelected(s.modes)[0] };
      return;
    case "2nd+mode":
      s.browse = null;
      return;
    case "prb":
      return openMenu(s, "prb", sc);
    case "2nd+prb":
      return openMenu(s, "angle", sc);
    case "2nd+var":
      return openMenu(s, "clearvar", sc);
    case "2nd+sto":
      return openMenu(s, "recall", sc);
    case "2nd+data":
      s.statBack = { t: "home" };
      return openMenu(s, "stats", sc);
    case "data":
      s.screen = { t: "data", col: 0, row: 0, top: 0, ed: null, formula: false };
      return;
    case "table":
      s.screen = { t: "tableFn" };
      s.table.fn.path = [];
      s.table.fn.pos = s.table.fn.els.length;
      return;
    case "2nd+div":
      if (s.k) {
        s.k = null;
        return;
      }
      s.kEd = newEd();
      s.screen = { t: "k" };
      return;
    case "on":
      return;
  }
  homeKey(s, k);
}

export { MODE_ROWS, menuTabs, modeSelected, tableRows, fmtOf };
