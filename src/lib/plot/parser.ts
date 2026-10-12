export type AngleMode = "rad" | "deg";

export type ParseErrorCode = "empty" | "unexpected" | "unexpectedEnd" | "unmatchedParen" | "unknownName" | "badNumber" | "notConstant" | "badEquation";

export interface ParseError {
  code: ParseErrorCode;
  /** Character offset in the source. */
  pos: number;
  /** The offending token or name. */
  detail?: string;
}

export interface Env {
  x: number;
  ans: number;
}

export type Evaluator = (env: Env) => number;

export interface Compiled {
  eval: Evaluator;
  usesX: boolean;
}

export type CompileResult = { ok: true; value: Compiled } | { ok: false; error: ParseError };

type Tok =
  | { t: "num"; v: number; pos: number }
  | { t: "fn"; v: string; pos: number }
  | { t: "const"; v: string; pos: number }
  | { t: "var"; v: string; pos: number }
  | { t: "op"; v: string; pos: number }
  | { t: "end"; pos: number };

export const FUNCTIONS = ["asin", "acos", "atan", "sin", "cos", "tan", "sqrt", "abs", "ln", "log", "exp", "floor", "ceil"] as const;
const FN_NAMES = [...FUNCTIONS].sort((a, b) => b.length - a.length);
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };
const OP_ALIASES: Record<string, string> = { "×": "*", "·": "*", "÷": "/", "−": "-", "–": "-" };

class Fail extends Error {
  constructor(readonly err: ParseError) {
    super(err.code);
  }
}

function tokenize(src: string, vars: readonly string[]): Tok[] {
  const out: Tok[] = [];
  const names = [...vars].sort((a, b) => b.length - a.length);
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t") {
      i++;
      continue;
    }
    if ((c >= "0" && c <= "9") || c === ".") {
      const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(src.slice(i));
      if (!m) throw new Fail({ code: "badNumber", pos: i, detail: c });
      out.push({ t: "num", v: Number(m[0]), pos: i });
      i += m[0].length;
      continue;
    }
    if (c === "π") {
      out.push({ t: "const", v: "pi", pos: i });
      i++;
      continue;
    }
    if (c === "√") {
      out.push({ t: "fn", v: "sqrt", pos: i });
      i++;
      continue;
    }
    if (/[a-z]/i.test(c)) {
      const rest = src.slice(i).toLowerCase();
      const fn = FN_NAMES.find((n) => rest.startsWith(n));
      if (fn) {
        out.push({ t: "fn", v: fn, pos: i });
        i += fn.length;
        continue;
      }
      const v = names.find((n) => rest.startsWith(n));
      if (v) {
        out.push({ t: "var", v, pos: i });
        i += v.length;
        continue;
      }
      const k = rest.startsWith("pi") ? "pi" : rest.startsWith("e") ? "e" : null;
      if (k) {
        out.push({ t: "const", v: k, pos: i });
        i += k.length;
        continue;
      }
      throw new Fail({ code: "unknownName", pos: i, detail: /^[a-z]+/i.exec(src.slice(i))![0] });
    }
    const op = OP_ALIASES[c] ?? c;
    if (op === "*" && src[i + 1] === "*") {
      out.push({ t: "op", v: "^", pos: i });
      i += 2;
      continue;
    }
    if ("+-*/^()".includes(op)) {
      out.push({ t: "op", v: op, pos: i });
      i++;
      continue;
    }
    throw new Fail({ code: "unexpected", pos: i, detail: c });
  }
  out.push({ t: "end", pos: src.length });
  return out;
}

const D2R = Math.PI / 180;

export function applyFunction(name: string, angle: AngleMode): (v: number) => number {
  const deg = angle === "deg";
  switch (name) {
    case "sin":
      return deg ? (v) => (v % 180 === 0 ? 0 : Math.sin(v * D2R)) : Math.sin;
    case "cos":
      return deg ? (v) => (Math.abs(v % 180) === 90 ? 0 : Math.cos(v * D2R)) : Math.cos;
    case "tan":
      return deg ? (v) => (Math.abs(v % 180) === 90 ? NaN : v % 180 === 0 ? 0 : Math.tan(v * D2R)) : Math.tan;
    case "asin":
      return deg ? (v) => Math.asin(v) / D2R : Math.asin;
    case "acos":
      return deg ? (v) => Math.acos(v) / D2R : Math.acos;
    case "atan":
      return deg ? (v) => Math.atan(v) / D2R : Math.atan;
    case "sqrt":
      return Math.sqrt;
    case "abs":
      return Math.abs;
    case "ln":
      return Math.log;
    case "log":
      return Math.log10;
    case "exp":
      return Math.exp;
    case "floor":
      return Math.floor;
    case "ceil":
      return Math.ceil;
  }
  return () => NaN;
}

class Parser {
  private i = 0;
  usesX = false;
  constructor(
    private toks: Tok[],
    private angle: AngleMode,
  ) {}

  private get cur() {
    return this.toks[this.i];
  }

  private isOp(v: string) {
    const c = this.cur;
    return c.t === "op" && c.v === v;
  }

  private startsFactor() {
    const c = this.cur;
    return c.t === "num" || c.t === "fn" || c.t === "const" || c.t === "var" || (c.t === "op" && c.v === "(");
  }

  parse(): Evaluator {
    const e = this.expr();
    const c = this.cur;
    if (c.t !== "end") {
      if (c.t === "op" && c.v === ")") throw new Fail({ code: "unmatchedParen", pos: c.pos });
      throw this.unexpected();
    }
    return e;
  }

  private unexpected(): Fail {
    const c = this.cur;
    if (c.t === "end") return new Fail({ code: "unexpectedEnd", pos: c.pos });
    return new Fail({ code: "unexpected", pos: c.pos, detail: c.t === "num" ? String(c.v) : c.v });
  }

  private expr(): Evaluator {
    let left = this.term();
    while (this.isOp("+") || this.isOp("-")) {
      const plus = this.isOp("+");
      this.i++;
      const l = left;
      const r = this.term();
      left = plus ? (env) => l(env) + r(env) : (env) => l(env) - r(env);
    }
    return left;
  }

  private term(): Evaluator {
    let left = this.unary();
    for (;;) {
      const explicit = this.isOp("*") || this.isOp("/");
      if (!explicit && !this.startsFactor()) return left;
      const mul = !this.isOp("/");
      if (explicit) this.i++;
      const l = left;
      const r = this.unary();
      left = mul ? (env) => l(env) * r(env) : (env) => l(env) / r(env);
    }
  }

  private unary(): Evaluator {
    if (this.isOp("-")) {
      this.i++;
      const v = this.unary();
      return (env) => -v(env);
    }
    if (this.isOp("+")) {
      this.i++;
      return this.unary();
    }
    return this.power();
  }

  private power(): Evaluator {
    const base = this.primary();
    if (this.isOp("^")) {
      this.i++;
      const exp = this.unary();
      return (env) => Math.pow(base(env), exp(env));
    }
    return base;
  }

  private primary(): Evaluator {
    const c = this.cur;
    if (c.t === "num") {
      this.i++;
      const v = c.v;
      return () => v;
    }
    if (c.t === "const") {
      this.i++;
      const v = CONSTS[c.v];
      return () => v;
    }
    if (c.t === "var") {
      this.i++;
      if (c.v === "x") {
        this.usesX = true;
        return (env) => env.x;
      }
      return (env) => env.ans;
    }
    if (c.t === "fn") {
      this.i++;
      const f = applyFunction(c.v, this.angle);
      let arg: Evaluator;
      if (this.isOp("(")) arg = this.paren();
      else if (this.startsFactor() || this.isOp("-")) arg = this.power();
      else throw this.unexpected();
      return (env) => f(arg(env));
    }
    if (this.isOp("(")) return this.paren();
    throw this.unexpected();
  }

  private paren(): Evaluator {
    const open = this.cur;
    this.i++;
    const e = this.expr();
    if (!this.isOp(")")) {
      if (this.cur.t === "end") throw new Fail({ code: "unmatchedParen", pos: open.pos });
      throw this.unexpected();
    }
    this.i++;
    return e;
  }
}

export function compile(src: string, angle: AngleMode = "rad", vars: readonly string[] = ["x"]): CompileResult {
  try {
    if (!src.trim()) throw new Fail({ code: "empty", pos: 0 });
    const p = new Parser(tokenize(src, vars), angle);
    const fn = p.parse();
    return { ok: true, value: { eval: fn, usesX: p.usesX } };
  } catch (e) {
    if (e instanceof Fail) return { ok: false, error: e.err };
    throw e;
  }
}

export function evaluate(src: string, angle: AngleMode = "rad", env: Partial<Env> = {}): { ok: true; value: number } | { ok: false; error: ParseError } {
  const r = compile(src, angle, ["x", "ans"]);
  if (!r.ok) return r;
  return { ok: true, value: r.value.eval({ x: 0, ans: 0, ...env }) };
}

export type Equation = { kind: "y"; compiled: Compiled } | { kind: "x"; value: number };
export type EquationResult = { ok: true; value: Equation } | { ok: false; error: ParseError };

/** `f`, `y = f`, or `x = c` (a vertical line). */
export function parseEquation(src: string, angle: AngleMode = "rad"): EquationResult {
  const eq = src.indexOf("=");
  if (eq < 0) {
    const r = compile(src, angle);
    return r.ok ? { ok: true, value: { kind: "y", compiled: r.value } } : r;
  }
  const second = src.indexOf("=", eq + 1);
  if (second >= 0) return { ok: false, error: { code: "badEquation", pos: second } };
  const lhs = src.slice(0, eq).trim().toLowerCase();
  if (lhs !== "y" && lhs !== "x" && lhs !== "f(x)") return { ok: false, error: { code: "badEquation", pos: 0 } };
  const r = compile(src.slice(eq + 1), angle);
  if (!r.ok) return { ok: false, error: { ...r.error, pos: r.error.pos + eq + 1 } };
  if (lhs !== "x") return { ok: true, value: { kind: "y", compiled: r.value } };
  if (r.value.usesX) return { ok: false, error: { code: "notConstant", pos: eq + 1 } };
  return { ok: true, value: { kind: "x", value: r.value.eval({ x: 0, ans: 0 }) } };
}
