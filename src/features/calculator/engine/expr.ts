import { type El, type TplKind, isTok, tok, VARS } from "./editor";
import type { Hint } from "./format";
import * as N from "./num";
import { CalcError, type Val, err, int, dec, PI, E13, PI13, isRational } from "./num";

export type Angle = "DEG" | "RAD" | "GRAD";

type Node = (
  | { t: "num"; v: Val }
  | { t: "sym"; name: string }
  | { t: "bin"; op: string; a: Node; b: Node }
  | { t: "neg"; a: Node }
  | { t: "post"; op: string; a: Node }
  | { t: "pow"; a: Node; b: Node; tpl?: boolean }
  | { t: "root"; i: Node; a: Node }
  | { t: "fn"; name: string; args: Node[] }
  | { t: "frac"; a: Node; b: Node }
  | { t: "mixed"; w: Node; a: Node; b: Node }
  | { t: "err" }
  | { t: "then"; a: Node }
) & { end?: number };

type Flagged = Node & { dms?: boolean };

export const FUNCS = [
  "sin(",
  "cos(",
  "tan(",
  "sin⁻¹(",
  "cos⁻¹(",
  "tan⁻¹(",
  "sinh(",
  "cosh(",
  "tanh(",
  "sinh⁻¹(",
  "cosh⁻¹(",
  "tanh⁻¹(",
  "log(",
  "ln(",
  "√(",
  "10^(",
  "e^(",
  "R▸Pr(",
  "R▸Pθ(",
  "P▸Rx(",
  "P▸Ry(",
  "randint(",
  "x'(",
  "y'(",
];
const CONV: Record<string, Hint> = { "▸n/d◂▸Un/d": "mixed", "▸F◂▸d": "fd", "▸DMS": "dms", "▸%": "pct", "◂▸": "toggle" };
const isConv = (v: string | undefined) => v !== undefined && v in CONV;
const POSTFIX = new Set(["²", "⁻¹", "!", "%", "°", "'", '"', "ʳ", "ᵍ"]);
const SYMS = /^(π|e|ans|rand|[xyztabc]|stat:.+|L[123])$/;

export interface Parsed {
  node: Node;
  hint?: Hint;
  store?: string;
  usedFrac: boolean;
}

class Parser {
  i = 0;
  usedFrac = false;
  stopped = false;
  constructor(public els: El[]) {}

  /** Nothing after an unmatched slot end is ever evaluated. */
  stop() {
    this.stopped = true;
    this.els = this.els.slice(0, this.i);
  }

  peek(): El | undefined {
    return this.els[this.i];
  }
  isT(v: string): boolean {
    return isTok(this.peek(), v);
  }
  tv(): string | undefined {
    const e = this.peek();
    return e && e.k === "t" ? e.v : undefined;
  }
  fail(at = this.i): never {
    throw new CalcError("SYNTAX", at);
  }
  /** Node ending at the current index: an error in it puts the cursor there. */
  at<T extends Node>(n: T): T {
    n.end = this.i;
    return n;
  }

  /** A template slot. Errors inside it point just after the template. An empty slot fails only when evaluated. */
  sub(list: El[]): Node {
    if (!list.length || this.stopped) return { t: "err", end: this.i };
    try {
      const p = new Parser(list);
      const n = p.add();
      if (p.i < p.els.length) this.fail();
      if (p.usedFrac) this.usedFrac = true;
      if (p.stopped) this.stop();
      const mark = (x: Node) => {
        x.end = this.i;
        for (const v of Object.values(x)) if (v && typeof v === "object" && "t" in v) mark(v as Node);
        if (x.t === "fn") x.args.forEach(mark);
      };
      mark(n);
      return n;
    } catch (e) {
      // a slot is evaluated in order: its syntax error is met only when evaluation reaches it
      if (e instanceof CalcError && e.code === "SYNTAX") return { t: "err", end: this.i };
      if (e instanceof CalcError) e.pos = this.i;
      throw e;
    }
  }

  top(): Parsed {
    let node = this.add();
    let hint: Hint;
    while (isConv(this.tv())) {
      hint = CONV[this.tv()!] ?? hint;
      if (hint === "mixed" && node.t === "mixed") hint = "improper";
      this.i++;
    }
    let store: string | undefined;
    if (this.isT("→")) {
      const arrow = this.i++;
      const v = this.tv();
      if (!v || !(VARS.includes(v) || v === "rand")) this.fail(arrow);
      store = v;
      this.i++;
    }
    if (this.i < this.els.length) this.fail();
    return { node, hint, store, usedFrac: this.usedFrac };
  }

  add(): Node {
    let a = this.mul();
    while (this.isT("+") || this.isT("-")) {
      const op = this.tv()!;
      this.i++;
      a = this.at({ t: "bin", op, a, b: this.mul() });
    }
    if (this.isT(SLOT_END)) {
      const end = this.i++;
      this.stop();
      return { t: "then", a, end };
    }
    return a;
  }

  startsPrimary(e: El | undefined): boolean {
    if (!e) return false;
    if (e.k !== "t") return e.k !== "pow";
    return /^[0-9.]$/.test(e.v) || e.v === "(" || SYMS.test(e.v) || FUNCS.includes(e.v);
  }

  mul(): Node {
    let a: Flagged = this.perm();
    for (;;) {
      if (this.isT("*") || this.isT("÷")) {
        const op = this.tv()!;
        this.i++;
        a = this.at({ t: "bin", op, a, b: this.perm() });
      } else if (this.startsPrimary(this.peek())) {
        const b: Flagged = this.perm();
        if (a.dms && b.dms) a = this.at({ t: "bin", op: "+", a, b, dms: true } as Flagged);
        else a = this.at({ t: "bin", op: "*", a, b });
      } else return a;
    }
  }

  perm(): Node {
    let a = this.neg();
    while (this.isT(" nPr ") || this.isT(" nCr ")) {
      const op = this.tv()!;
      this.i++;
      a = this.at({ t: "bin", op, a, b: this.neg() });
    }
    return a;
  }

  neg(): Node {
    if (this.isT("⁻")) {
      this.i++;
      return this.at({ t: "neg", a: this.neg() });
    }
    return this.pow();
  }

  pow(): Node {
    let a = this.post();
    while (this.isT("^") || this.isT("ˣ√")) {
      const op = this.tv()!;
      this.i++;
      let negs = 0;
      while (this.isT("⁻")) {
        negs++;
        this.i++;
      }
      let b = this.post();
      for (let k = 0; k < negs; k++) b = { t: "neg", a: b };
      a = this.at(op === "^" ? { t: "pow", a, b } : { t: "root", i: a, a: b });
    }
    return a;
  }

  post(): Node {
    let a: Flagged = this.primary();
    for (;;) {
      const e = this.peek();
      if (e && e.k === "pow") {
        this.i++;
        a = this.at({ t: "pow", a, b: this.sub(e.s[0]), tpl: true });
      } else if (e && e.k === "t" && POSTFIX.has(e.v)) {
        this.i++;
        const dms = e.v === "°" || e.v === "'" || e.v === '"';
        a = this.at({ t: "post", op: e.v, a, dms } as Flagged);
      } else return a;
    }
  }

  number(): Node {
    let s = "";
    while (this.tv() !== undefined && /^[0-9.]$/.test(this.tv()!)) {
      s += this.tv();
      this.i++;
    }
    if ((s.match(/\./g) ?? []).length > 1 || s === ".") this.fail();
    return this.at({ t: "num", v: s.includes(".") ? dec(Number(s)) : int(Number(s)) });
  }

  classicOperand(): Node {
    const v = this.tv();
    if (v !== undefined && /^[0-9.]$/.test(v)) return this.number();
    if (v !== undefined && SYMS.test(v)) {
      this.i++;
      return { t: "sym", name: v };
    }
    return this.fail();
  }

  primary(): Node {
    const n = this.primaryNode();
    n.end ??= this.i;
    return n;
  }

  primaryNode(): Node {
    const e = this.peek();
    if (!e) return this.fail();
    if (e.k !== "t") {
      this.i++;
      switch (e.k) {
        case "frac":
          this.usedFrac = true;
          return { t: "frac", a: this.sub(e.s[0]), b: this.sub(e.s[1]) };
        case "mixed":
          this.usedFrac = true;
          return { t: "mixed", w: this.sub(e.s[0]), a: this.sub(e.s[1]), b: this.sub(e.s[2]) };
        case "sqrt":
          return { t: "fn", name: "√(", args: [this.sub(e.s[0])] };
        case "root":
          return { t: "root", i: this.sub(e.s[0]), a: this.sub(e.s[1]) };
        default:
          return this.fail(this.i - 1);
      }
    }
    const v = e.v;
    if (/^[0-9.]$/.test(v)) {
      const n = this.number();
      if (this.isT("␣")) {
        this.i++;
        const a = this.classicOperand();
        if (!this.isT("⁄")) this.fail();
        this.i++;
        this.usedFrac = true;
        return { t: "mixed", w: n, a, b: this.classicOperand() };
      }
      if (this.isT("⁄")) {
        this.i++;
        this.usedFrac = true;
        return { t: "frac", a: n, b: this.classicOperand() };
      }
      return n;
    }
    if (SYMS.test(v)) {
      this.i++;
      const n: Node = { t: "sym", name: v };
      if (this.isT("⁄")) {
        this.i++;
        this.usedFrac = true;
        return { t: "frac", a: n, b: this.classicOperand() };
      }
      return n;
    }
    if (v === "(") {
      this.i++;
      const n = this.add();
      this.close();
      return n;
    }
    if (FUNCS.includes(v)) {
      this.i++;
      const args = [this.add()];
      while (this.isT(",")) {
        this.i++;
        args.push(this.add());
      }
      const n = this.at<Node>({ t: "fn", name: v, args });
      this.close();
      return n;
    }
    return this.fail();
  }

  close() {
    if (this.isT(")")) this.i++;
    else if (this.i < this.els.length && !this.isConvOrStore()) this.fail();
  }

  isConvOrStore(): boolean {
    const v = this.tv();
    return v === "→" || isConv(v);
  }
}

/** Marks the end of a template slot that a typed `)` closed early (BEHAVIOR §21). */
const SLOT_END = "\uE007";
const LAST_SLOT: Record<TplKind, number> = { frac: 1, mixed: 2, sqrt: 0, root: 1, pow: 0 };

function earlyClose(slot: El[]): number {
  let depth = 0;
  for (let j = 0; j < slot.length; j++) {
    const e = slot[j];
    if (e.k !== "t") continue;
    if (e.v.endsWith("(")) depth++;
    else if (e.v === ")" && depth-- === 0) return j;
  }
  return -1;
}

/** Slots are parenthesised groups: a `)` typed in one closes it. In the last slot the template's
 * operation runs there and the rest of the slot continues outside it; the slot's own end is then
 * an unmatched `)`. `map` gets the original index of each output element. */
function splitSlots(list: El[], map?: number[]): El[] {
  const out: El[] = [];
  const queue = list.map((el, idx) => ({ el, idx }));
  while (queue.length) {
    const { el, idx } = queue.shift()!;
    map?.push(idx);
    if (el.k === "t") {
      out.push(el);
      continue;
    }
    let tail: El[] = [];
    const s = el.s.map((slot, k) => {
      const j = earlyClose(slot);
      if (j < 0) return splitSlots(slot);
      const group = splitSlots(slot.slice(0, j));
      if (k !== LAST_SLOT[el.k]) return [...group, tok(SLOT_END)];
      tail = [...slot.slice(j + 1), tok(SLOT_END)];
      return group;
    });
    out.push({ k: el.k, s });
    queue.unshift(...tail.map((e) => ({ el: e, idx: idx + 1 })));
  }
  return out;
}

const parseSplit = (els: El[]): Parsed => new Parser(els).top();

export const parse = (els: El[]): Parsed => parseSplit(splitSlots(els));

export interface StatVals {
  [k: string]: number | "Error";
}

export interface Ctx {
  angle: Angle;
  vars: Record<string, Val>;
  ans: Val;
  stat: StatVals | null;
  rand: () => number;
  lists?: Val[][];
  listIndex?: number;
}

const D180 = int(180);

function toDeg(v: Val, angle: Angle): Val {
  if (angle === "DEG") return v;
  if (angle === "GRAD") return N.mul(v, N.fromQ({ n: 9, m: 10, r: 1, pi: 0 }));
  if (v.q && v.q.pi) return N.div(N.mul(v, D180), PI);
  return dec((v.d * 180) / Math.PI);
}

function fromDeg(deg: Val, angle: Angle, exactRad = false): Val {
  if (angle === "DEG") return deg;
  if (angle === "GRAD") return N.mul(deg, N.fromQ({ n: 10, m: 9, r: 1, pi: 0 }));
  if (exactRad && deg.q) return N.div(N.mul(deg, PI), D180);
  return dec((deg.d * PI13) / 180);
}

const half = N.fromQ({ n: 1, m: 2, r: 1, pi: 0 });
const r2 = N.fromQ({ n: 1, m: 2, r: 2, pi: 0 });
const r3 = N.fromQ({ n: 1, m: 2, r: 3, pi: 0 });
const SIN_TABLE: Record<number, Val> = {
  0: int(0),
  30: half,
  45: r2,
  60: r3,
  90: int(1),
};

function sinDegExact(a: number): Val | undefined {
  a = ((a % 360) + 360) % 360;
  const sign = a >= 180 ? -1 : 1;
  let r = a % 180;
  if (r > 90) r = 180 - r;
  const v = SIN_TABLE[r];
  if (!v) return undefined;
  return sign < 0 ? N.neg(v) : v;
}

function trig(name: "sin" | "cos" | "tan", x: Val, angle: Angle): Val {
  const deg = toDeg(x, angle);
  if (deg.q && isRational(deg) && deg.q.m === 1) {
    const a = deg.q.n;
    const s = sinDegExact(a);
    const c = sinDegExact(a + 90);
    if (s && c) {
      if (name === "sin") return s;
      if (name === "cos") return c;
      if (c.d === 0) err("DOMAIN");
      return N.div(s, c);
    }
  }
  let rad: number;
  if (angle === "RAD" && !(x.q && x.q.pi)) rad = x.d;
  else rad = ((((deg.d % 360) + 360) % 360) * Math.PI) / 180;
  if (name === "sin") return dec(Math.sin(rad));
  const c = Math.cos(rad);
  if (name === "cos") return dec(Math.abs(c) < 1e-15 ? 0 : c);
  if (Math.abs(c) < 1e-12) err("DOMAIN");
  return dec(Math.tan(rad));
}

function sameVal(a: Val, b: Val) {
  return a.q && b.q && a.q.n === b.q.n && a.q.m === b.q.m && a.q.r === b.q.r && a.q.pi === b.q.pi;
}

function invTrig(name: "sin" | "cos" | "tan", x: Val, angle: Angle): Val {
  if (name !== "tan" && Math.abs(x.d) > 1) err("DOMAIN");
  if (x.q) {
    const cands = name === "tan" ? [0, 30, 45, 60, -30, -45, -60] : name === "sin" ? [0, 30, 45, 60, 90, -30, -45, -60, -90] : [0, 30, 45, 60, 90, 120, 135, 150, 180];
    for (const a of cands) {
      const v = trig(name, int(a), "DEG");
      if (sameVal(v, x)) return fromDeg(int(a), angle);
    }
  }
  const r = name === "sin" ? Math.asin(x.d) : name === "cos" ? Math.acos(x.d) : Math.atan(x.d);
  if (angle === "RAD") return dec(r);
  return fromDeg(dec((r * 180) / Math.PI), angle);
}

function angleMark(op: string, v: Val, angle: Angle): Val {
  switch (op) {
    case "°":
      return fromDeg(v, angle, true);
    case "'":
      return fromDeg(dec(v.d / 60), angle);
    case '"':
      return fromDeg(dec(v.d / 3600), angle);
    case "ʳ":
      if (angle === "RAD") return v;
      return fromDeg(toDeg(v, "RAD"), angle);
    default:
      if (angle === "GRAD") return v;
      return fromDeg(toDeg(v, "GRAD"), angle, true);
  }
}

function needInt(v: Val) {
  if (!Number.isInteger(v.d)) err("DOMAIN");
}

export function evaluate(node: Node, ctx: Ctx): Val {
  try {
    return evalNode(node, ctx);
  } catch (e) {
    if (e instanceof CalcError && e.pos === undefined) {
      e.pos = node.end;
      e.inSlot = node.t === "pow" && node.tpl;
    }
    throw e;
  }
}

function evalNode(node: Node, ctx: Ctx): Val {
  const ev = (n: Node) => evaluate(n, ctx);
  switch (node.t) {
    case "num":
      return node.v;
    case "sym": {
      const s = node.name;
      if (s === "π") return PI;
      if (s === "e") return dec(E13);
      if (s === "ans") return ctx.ans;
      if (s === "rand") return dec(ctx.rand());
      if (VARS.includes(s)) return ctx.vars[s] ?? int(0);
      if (s.startsWith("L")) {
        const l = ctx.lists?.[Number(s[1]) - 1];
        if (!l || ctx.listIndex === undefined) return err("FORMULA");
        if (ctx.listIndex >= l.length) return err("DIM MISMATCH");
        return l[ctx.listIndex];
      }
      const name = s.slice(5);
      const v = ctx.stat?.[name];
      if (v === undefined) return err("STAT");
      if (v === "Error") return err("DIVIDE BY 0");
      return dec(v);
    }
    case "bin": {
      const a = ev(node.a);
      const b = ev(node.b);
      switch (node.op) {
        case "+":
          return N.add(a, b);
        case "-":
          return N.sub(a, b);
        case "*":
          return N.mul(a, b);
        case "÷":
          return N.decimal(N.div(a, b));
        case " nPr ":
          return N.nPr(a, b);
        default:
          return N.nCr(a, b);
      }
    }
    case "neg":
      return N.neg(ev(node.a));
    case "post": {
      const a = ev(node.a);
      switch (node.op) {
        case "²":
          return N.mul(a, a);
        case "⁻¹":
          if (a.d === 0) err("DOMAIN");
          return N.div(int(1), a);
        case "!":
          return N.factorial(a);
        case "%":
          return N.decimal(N.div(a, int(100)));
        default:
          return angleMark(node.op, a, ctx.angle);
      }
    }
    case "pow":
      return N.pow(ev(node.a), ev(node.b));
    case "root":
      return N.root(ev(node.i), ev(node.a));
    case "frac":
      return N.div(ev(node.a), ev(node.b));
    case "mixed": {
      const w = ev(node.w);
      const f = N.div(ev(node.a), ev(node.b));
      return w.d < 0 ? N.sub(w, f) : N.add(w, f);
    }
    case "fn":
      return evalFn(node.name, node.args.map(ev), ctx);
    case "err":
      return err("SYNTAX");
    case "then":
      ev(node.a);
      return err("SYNTAX");
  }
}

function evalFn(name: string, args: Val[], ctx: Ctx): Val {
  const arity = ["R▸Pr(", "R▸Pθ(", "P▸Rx(", "P▸Ry(", "randint("].includes(name) ? 2 : 1;
  if (args.length !== arity) err("ARGUMENT");
  const [x, y] = args;
  const base = name.replace("(", "");
  switch (base) {
    case "sin":
    case "cos":
    case "tan":
      return trig(base, x, ctx.angle);
    case "sin⁻¹":
    case "cos⁻¹":
    case "tan⁻¹":
      return invTrig(base.slice(0, 3) as "sin", x, ctx.angle);
    case "sinh":
      return dec(Math.sinh(x.d));
    case "cosh":
      return dec(Math.cosh(x.d));
    case "tanh":
      return dec(Math.tanh(x.d));
    case "sinh⁻¹":
      return dec(Math.asinh(x.d));
    case "cosh⁻¹":
      if (x.d < 1) err("DOMAIN");
      return dec(Math.acosh(x.d));
    case "tanh⁻¹":
      if (Math.abs(x.d) >= 1) err("DOMAIN");
      return dec(Math.atanh(x.d));
    case "log":
      return N.log10(x);
    case "ln":
      return N.ln(x);
    case "√":
      return N.sqrt(x);
    case "10^":
      return N.pow(int(10), x);
    case "e^":
      return N.exp(x);
    case "R▸Pr":
      return dec(N.sqrt(N.add(N.mul(x, x), N.mul(y, y))).d);
    case "R▸Pθ": {
      const deg = (Math.atan2(y.d, x.d) * 180) / Math.PI;
      return dec(fromDeg(dec(deg), ctx.angle).d);
    }
    case "P▸Rx":
      return dec(N.mul(x, trig("cos", y, ctx.angle)).d);
    case "P▸Ry":
      return dec(N.mul(x, trig("sin", y, ctx.angle)).d);
    case "randint": {
      needInt(x);
      needInt(y);
      const lo = Math.min(x.d, y.d);
      const hi = Math.max(x.d, y.d);
      return int(lo + Math.floor(ctx.rand() * (hi - lo + 1)));
    }
    case "x'":
    case "y'": {
      const a = ctx.stat?.a;
      const b = ctx.stat?.b;
      if (typeof a !== "number" || typeof b !== "number") return err("STAT");
      if (base === "x'") {
        if (a === 0) err("DIVIDE BY 0");
        return dec((x.d - b) / a);
      }
      return dec(a * x.d + b);
    }
  }
  return err("SYNTAX");
}

export interface EvalResult {
  val: Val;
  hint?: Hint;
  store?: string;
  usedFrac: boolean;
}

/** Errors come in evaluation order (BEHAVIOR §21): when the entry has a syntax error, the longest
 * well-formed prefix is evaluated first and any math error in it wins. */
const openParens = (els: El[]) =>
  els.reduce((n, e) => (e.k !== "t" ? n : e.v.endsWith("(") ? n + 1 : e.v === ")" ? n - 1 : n), 0);

function parseOrPrefixError(els: El[], ctx: Ctx): Parsed {
  try {
    return parseSplit(els);
  } catch (e) {
    if (!(e instanceof CalcError) || e.code !== "SYNTAX") throw e;
    for (let k = els.length - 1; k > 0; k--) {
      // a function's whole argument is parsed before the function is applied
      if (openParens(els.slice(0, k)) > 0) continue;
      let prefix: Parsed;
      try {
        prefix = parseSplit(els.slice(0, k));
      } catch {
        continue;
      }
      try {
        evaluate(prefix.node, ctx);
      } catch (inner) {
        if (inner instanceof CalcError && inner.code !== "SYNTAX") throw inner;
      }
      break;
    }
    throw e;
  }
}

export function run(els: El[], ctx: Ctx): EvalResult {
  const map: number[] = [];
  const split = splitSlots(els, map);
  try {
    const p = parseOrPrefixError(split, ctx);
    const val = evaluate(p.node, ctx);
    return { val, hint: p.hint, store: p.store, usedFrac: p.usedFrac };
  } catch (e) {
    if (e instanceof CalcError && e.pos !== undefined) e.pos = e.pos < map.length ? map[e.pos] : els.length;
    throw e;
  }
}

export { PI13 };
