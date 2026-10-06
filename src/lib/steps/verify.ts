import { parse, type MathNode } from "mathjs/number";

/** Deterministic step verification: numeric equivalence tests over parsed math (mathjs parser, own real-valued evaluator). */

type Scope = Record<string, number>;
interface Compiled {
  vars: Set<string>;
  f: (s: Scope) => number;
}

export type Parsed =
  | { kind: "expr"; e: Compiled }
  | { kind: "eq"; l: Compiled; r: Compiled; f: Compiled; solvedFor: string | null }
  | { kind: "chain"; parts: Compiled[] };

export type CalcCheck =
  | { status: "right"; kind: "value" | "solutions" }
  | { status: "undecided" }
  | { status: "wrong"; kind: "value"; at: Scope; before: number | null; after: number | null }
  | { status: "wrong"; kind: "solutions"; solution: number | null; var: string | null; solvesBefore: boolean };

const realRoot = (a: number, n: number) => (a < 0 && Number.isInteger(n) && n % 2 === 1 ? -Math.pow(-a, 1 / n) : Math.pow(a, 1 / n));
const FUNCS: Record<string, (...a: number[]) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  cot: (x) => 1 / Math.tan(x),
  sec: (x) => 1 / Math.cos(x),
  csc: (x) => 1 / Math.sin(x),
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  arcsin: Math.asin,
  arccos: Math.acos,
  arctan: Math.atan,
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  exp: Math.exp,
  log: Math.log,
  log10: Math.log10,
  log2: Math.log2,
  abs: Math.abs,
  nthRoot: realRoot,
};
const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E };
const VAR_RE = /^[a-zA-Z](?:_?[0-9]+|_[a-zA-Z0-9]+)?$/;

function readGroup(t: string, i: number): [string, number] | null {
  while (t[i] === " ") i++;
  if (t[i] === "{") {
    let depth = 0;
    for (let j = i; j < t.length; j++) {
      if (t[j] === "{") depth++;
      else if (t[j] === "}" && --depth === 0) return [t.slice(i + 1, j), j + 1];
    }
    return null;
  }
  return i < t.length ? [t[i], i + 1] : null;
}

function expandCommands(t: string): string | null {
  for (let guard = 0; guard < 200; guard++) {
    const m = /\\(frac|sqrt)/.exec(t);
    if (!m) return t;
    let i = m.index + m[0].length;
    if (m[1] === "frac") {
      const a = readGroup(t, i);
      if (!a) return null;
      const b = readGroup(t, a[1]);
      if (!b) return null;
      t = `${t.slice(0, m.index)}((${a[0]})/(${b[0]}))${t.slice(b[1])}`;
    } else {
      let n: string | null = null;
      if (t[i] === "[") {
        const close = t.indexOf("]", i);
        if (close < 0) return null;
        n = t.slice(i + 1, close);
        i = close + 1;
      }
      const a = readGroup(t, i);
      if (!a) return null;
      t = `${t.slice(0, m.index)}${n ? `nthRoot((${a[0]}),(${n}))` : `sqrt(${a[0]})`}${t.slice(a[1])}`;
    }
  }
  return null;
}

/** LaTeX-ish / handwritten-style math → mathjs syntax. Returns null when it clearly isn't plain math. */
export function normalizeMath(input: string): string | null {
  let t = input.trim();
  t = t.replace(/^\$+|\$+$/g, "").replace(/^\\\[|\\\]$/g, "").replace(/^\\\(|\\\)$/g, "").trim();
  t = t.replace(/^(?:step|schritt)\s*\d+\s*[.):]?\s*/i, "").replace(/^\d+[.)]\s+/, "");
  t = t.replace(/\\text\{[^}]*\}/g, " ").replace(/\\(?:mathrm|operatorname)\{([^}]*)\}/g, "$1");
  t = t.replace(/\\q?quad\b.*$/, "");
  t = t.replace(/\s\|\s*[-+:*/÷·⋅×]\s*[^|=]*$/, "");
  t = t.replace(/^(?:\\Rightarrow|\\implies|\\Leftrightarrow|\\iff|\\therefore|⇒|⇔|→|=>|∴)\s*/, "");
  t = t.replace(/\\left\s*|\\right\s*|\\[,;!: ]/g, "");
  t = t.replace(/\\[dt]frac/g, "\\frac");
  const expanded = expandCommands(t);
  if (expanded == null) return null;
  t = expanded;
  t = t.replace(/\\cdot|\\times|\\ast|[×·⋅∙]/g, "*").replace(/\\div|÷|:/g, "/");
  t = t.replace(/[−–—]/g, "-").replace(/²/g, "^2").replace(/³/g, "^3").replace(/π/g, "pi").replace(/√/g, "sqrt");
  t = t.replace(/\\pm|\\mp/g, "±");
  t = t.replace(/\\(?:lvert|rvert|vert|mid)/g, "|");
  t = t.replace(/\\?\blog\b(?!_)/g, "log10").replace(/\\?\bln\b/g, "log");
  t = t.replace(/\\(pi|sin|cos|tan|cot|sec|csc|arcsin|arccos|arctan|sinh|cosh|tanh|exp)\b/g, "$1");
  t = t.replace(/[{]/g, "(").replace(/[}]/g, ")").replace(/\[/g, "(").replace(/\]/g, ")");
  t = t.replace(/\|([^|]+)\|/g, "abs($1)");
  t = t.replace(/\.\s*$/, "").replace(/\s+/g, " ").trim();
  if (!t || /[\\|"'?]/.test(t)) return null;
  return t;
}

function compileNode(node: MathNode, vars: Set<string>): (s: Scope) => number {
  const n = node as MathNode & Record<string, unknown>;
  switch (node.type) {
    case "ConstantNode": {
      const v = n.value;
      if (typeof v !== "number") throw new Error("bad constant");
      return () => v;
    }
    case "ParenthesisNode":
      return compileNode(n.content as MathNode, vars);
    case "SymbolNode":
      return compileSymbol(n.name as string, vars);
    case "FunctionNode": {
      const name = (n.fn as { name?: string }).name ?? "";
      const args = (n.args as MathNode[]).map((a) => compileNode(a, vars));
      const fn = FUNCS[name];
      if (fn) return (s) => fn(...args.map((a) => a(s)));
      if (args.length !== 1) throw new Error("unknown function");
      // x(x+1) is implicit multiplication, not a function call
      const sym = compileSymbol(name, vars);
      return (s) => sym(s) * args[0](s);
    }
    case "OperatorNode": {
      const args = (n.args as MathNode[]).map((a) => compileNode(a, vars));
      const [a, b] = args;
      switch (n.fn) {
        case "add":
          return (s) => a(s) + b(s);
        case "subtract":
          return (s) => a(s) - b(s);
        case "multiply":
          return (s) => a(s) * b(s);
        case "divide":
          return (s) => a(s) / b(s);
        case "pow":
          return (s) => Math.pow(a(s), b(s));
        case "unaryMinus":
          return (s) => -a(s);
        case "unaryPlus":
          return a;
        case "factorial":
          return (s) => {
            const v = a(s);
            if (!Number.isInteger(v) || v < 0 || v > 170) return NaN;
            let r = 1;
            for (let k = 2; k <= v; k++) r *= k;
            return r;
          };
      }
      throw new Error("unsupported operator");
    }
  }
  throw new Error("unsupported node");
}

function compileSymbol(name: string, vars: Set<string>): (s: Scope) => number {
  if (name in CONSTS) {
    const c = CONSTS[name];
    return () => c;
  }
  if (VAR_RE.test(name)) {
    vars.add(name);
    return (s) => s[name];
  }
  if (/^[a-zA-Z]{2,3}$/.test(name)) {
    const letters = [...name];
    letters.forEach((l) => vars.add(l));
    return (s) => letters.reduce((p, l) => p * s[l], 1);
  }
  throw new Error("unknown symbol");
}

const ALLOWED_WORDS = new Set([...Object.keys(FUNCS), ...Object.keys(CONSTS)]);

/** mathjs-syntax string → real-valued function, or null if it isn't plain math. */
export function compileExpr(src: string): Compiled | null {
  const t = src.trim();
  if (!t || t.includes("±")) return null;
  for (const w of t.match(/[a-zA-Z]{4,}\d*/g) ?? []) if (!ALLOWED_WORDS.has(w)) return null;
  try {
    const vars = new Set<string>();
    const f = compileNode(parse(t), vars);
    return { vars, f };
  } catch {
    return null;
  }
}

function product(fs: Compiled[]): Compiled {
  const vars = new Set(fs.flatMap((c) => [...c.vars]));
  return { vars, f: (s) => fs.reduce((p, c) => p * c.f(s), 1) };
}

function difference(l: Compiled, r: Compiled): Compiled {
  return { vars: new Set([...l.vars, ...r.vars]), f: (s) => l.f(s) - r.f(s) };
}

function equation(l: Compiled, r: Compiled, lhsText: string): Parsed {
  const v = lhsText.trim();
  const solvedFor = VAR_RE.test(v) && ![...r.vars].includes(v) ? v : null;
  return { kind: "eq", l, r, f: difference(l, r), solvedFor };
}

/** "x = 2 or x = -2", "x_1 = 2, x_2 = -2", "x = 3 ± 2" → one equation whose solutions are that set. */
function parseSolutionSet(t: string): Parsed | null {
  const parts = t.split(/\s+(?:or|oder|\\lor|\\vee)\s+|∨|[,;]/).map((p) => p.trim()).filter(Boolean);
  const pm = /^([a-zA-Z])(?:_?\d+)?\s*=\s*(.*±.*)$/.exec(t);
  const items: { v: string; rhs: string }[] = [];
  if (pm && parts.length === 1) {
    items.push({ v: pm[1], rhs: pm[2].replace("±", "+") }, { v: pm[1], rhs: pm[2].replace("±", "-") });
  } else if (parts.length > 1) {
    for (const p of parts) {
      const m = /^([a-zA-Z])(?:_?\d+)?\s*=\s*([^=]+)$/.exec(p);
      if (!m) return null;
      items.push({ v: m[1], rhs: m[2] });
    }
  } else return null;
  const v = items[0].v;
  if (items.some((i) => i.v !== v)) return null;
  const factors: Compiled[] = [];
  for (const i of items) {
    const c = compileExpr(i.rhs);
    if (!c || c.vars.size) return null;
    factors.push({ vars: new Set([v]), f: (s) => s[v] - c.f(s) });
  }
  const f = product(factors);
  const zero: Compiled = { vars: new Set(), f: () => 0 };
  return { kind: "eq", l: f, r: zero, f, solvedFor: v };
}

export type Mode = "solve" | "simplify";

/** One line of work → expression, equation or chain (a = b = c). Inequalities and prose → null. */
export function parseStep(text: string, mode: Mode = "solve"): Parsed | null {
  const t = normalizeMath(text);
  if (!t) return null;
  if (/[<>≤≥≠]|\\(?:le|ge|leq|geq|neq|lt|gt)\b/.test(t)) return null;
  const set = parseSolutionSet(t);
  if (set) return set;
  if (t.startsWith("=")) {
    const e = compileExpr(t.slice(1));
    return e ? { kind: "expr", e } : null;
  }
  const sides = t.split("=");
  if (sides.some((x) => !x.trim())) return null;
  const parts = sides.map(compileExpr);
  if (parts.some((p) => !p)) return null;
  const ok = parts as Compiled[];
  if (ok.length === 1) return { kind: "expr", e: ok[0] };
  if (ok.length === 2 && mode === "solve") return equation(ok[0], ok[1], sides[0]);
  return { kind: "chain", parts: ok };
}

/** The math in a problem statement such as "Solve: 2(x-3)+4=10" or "Simplify -(x-3)+2x". */
export function parseProblem(problem: string | undefined): Parsed | null {
  if (!problem?.trim()) return null;
  const tries = [problem, problem.slice(problem.lastIndexOf(":") + 1)];
  const tail = /[-+(\d\\a-zA-Z{][-+*/^=().,\s\d\\a-zA-Z{}|·×÷²³√π−]*$/.exec(problem.replace(/[.?!]\s*$/, ""));
  if (tail) {
    // drop leading words ("Solve for x ...") one at a time
    const words = tail[0].split(/\s+/);
    for (let i = 0; i < words.length; i++) tries.push(words.slice(i).join(" "));
  }
  for (const t of tries) {
    const p = parseStep(t, "solve");
    if (p) return p;
  }
  return null;
}

// ---------- numeric checks ----------

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function points(vars: string[], n = 16): Scope[] {
  const r = rng(20240611);
  return Array.from({ length: n }, (_, k) =>
    Object.fromEntries(vars.map((v) => [v, k < n / 2 ? r() * 8 - 4 : 0.15 + r() * 4.85])),
  );
}

const val = (c: Compiled, s: Scope): number | null => {
  const v = c.f(s);
  return Number.isFinite(v) ? v : null;
};
const close = (a: number, b: number) => Math.abs(a - b) <= 1e-7 * Math.max(1, Math.abs(a), Math.abs(b));

export function compareExpr(a: Compiled, b: Compiled): CalcCheck {
  const vars = [...new Set([...a.vars, ...b.vars])];
  let valid = 0;
  let wrong: { at: Scope; before: number; after: number } | null = null;
  let mismatches = 0;
  for (const p of points(vars)) {
    const x = val(a, p);
    const y = val(b, p);
    if (x == null || y == null) continue;
    valid++;
    if (!close(x, y)) {
      mismatches++;
      wrong ??= { at: p, before: x, after: y };
    }
  }
  if (wrong && (mismatches >= 2 || valid <= 4)) return { status: "wrong", kind: "value", ...wrong };
  if (!mismatches && valid >= 5) return { status: "right", kind: "value" };
  return { status: "undecided" };
}

function isRoot(c: Compiled, v: string, x: number): boolean {
  const y = val(c, { [v]: x });
  if (y == null) return false;
  const around = [val(c, { [v]: x + 1e-3 }), val(c, { [v]: x - 1e-3 })].map((z) => Math.abs(z ?? 0));
  return Math.abs(y) <= 1e-6 * Math.max(1, ...around);
}

/** Real solutions in [-60, 60]: sign changes (bisected) plus exact hits at integers and halves. */
export function rootsOf(c: Compiled, v: string): number[] {
  const out: number[] = [];
  const at = (x: number) => val(c, { [v]: x });
  const lo = -60;
  const step = 0.025;
  let px = lo;
  let py = at(lo);
  for (let i = 1; i <= 4800; i++) {
    const x = lo + i * step;
    const y = at(x);
    if (py != null && y != null && py * y < 0) {
      let a = px;
      let b = x;
      let fa = py;
      for (let k = 0; k < 80; k++) {
        const m = (a + b) / 2;
        const fm = at(m);
        if (fm == null) break;
        if (fa * fm <= 0) b = m;
        else {
          a = m;
          fa = fm;
        }
      }
      const r = (a + b) / 2;
      if (isRoot(c, v, r)) out.push(r);
    }
    px = x;
    py = y;
  }
  for (let k = lo * 2; k <= -lo * 2; k++) if (isRoot(c, v, k / 2)) out.push(k / 2);
  out.sort((a, b) => a - b);
  return out.filter((x, i) => i === 0 || Math.abs(x - out[i - 1]) > 1e-6);
}

/** Two equations are equivalent when they have the same solutions. */
export function compareEquations(a: Compiled, b: Compiled): CalcCheck {
  const vars = [...new Set([...a.vars, ...b.vars])];
  const pts = points(vars);
  const fa = pts.map((p) => val(a, p));
  const fb = pts.map((p) => val(b, p));
  const both = fa.map((x, i) => [x, fb[i]] as const).filter(([x, y]) => x != null && y != null) as [number, number][];
  const zero = (x: number) => Math.abs(x) <= 1e-9;
  if (vars.length === 0) {
    if (!both.length) return { status: "undecided" };
    const [x, y] = both[0];
    return zero(x) === zero(y)
      ? { status: "right", kind: "solutions" }
      : { status: "wrong", kind: "solutions", solution: null, var: null, solvesBefore: zero(x) };
  }
  if (both.length >= 5) {
    if (both.every(([x, y]) => zero(x) && zero(y))) return { status: "right", kind: "solutions" };
    const ratios = both.filter(([x]) => !zero(x)).map(([x, y]) => y / x);
    if (ratios.length >= 5 && !zero(ratios[0]) && ratios.every((r) => close(r, ratios[0]))) {
      return { status: "right", kind: "solutions" };
    }
  }
  if (vars.length !== 1) return { status: "undecided" };
  const v = vars[0];
  const candidates = [...rootsOf(a, v), ...rootsOf(b, v)];
  for (const r of candidates) {
    const ra = isRoot(a, v, r);
    const rb = isRoot(b, v, r);
    if (ra !== rb) return { status: "wrong", kind: "solutions", solution: r, var: v, solvesBefore: ra };
  }
  // an identity (every x) vs. an equation with finitely many solutions
  const idA = both.length >= 5 && both.every(([x]) => zero(x));
  const idB = both.length >= 5 && both.every(([, y]) => zero(y));
  if (idA !== idB) return { status: "wrong", kind: "solutions", solution: null, var: v, solvesBefore: idA };
  return candidates.length ? { status: "right", kind: "solutions" } : { status: "undecided" };
}

function isIdentity(p: Parsed): boolean {
  return p.kind === "eq" && compareExpr(p.l, p.r).status === "right";
}

const firstOf = (p: Parsed): Compiled | null => (p.kind === "expr" ? p.e : p.kind === "chain" ? p.parts[0] : null);
const lastOf = (p: Parsed): Compiled | null => (p.kind === "expr" ? p.e : p.kind === "chain" ? p.parts[p.parts.length - 1] : null);

function chainCheck(p: Parsed): CalcCheck | null {
  if (p.kind !== "chain") return null;
  for (let i = 1; i < p.parts.length; i++) {
    const c = compareExpr(p.parts[i - 1], p.parts[i]);
    if (c.status !== "right") return c;
  }
  return { status: "right", kind: "value" };
}

export function modeOf(problem: Parsed | null): Mode {
  return problem?.kind === "expr" || problem?.kind === "chain" ? "simplify" : "solve";
}

/** Checks every step against the step before it (step 1 against the problem when it parses). */
export function verifySteps(problem: string | undefined, steps: string[]): CalcCheck[] {
  const prob = parseProblem(problem);
  const mode = modeOf(prob);
  let anchor: Parsed | null = prob;
  return steps.map((text) => {
    const p = parseStep(text, mode);
    if (!p) {
      anchor = null;
      return { status: "undecided" };
    }
    const inner = chainCheck(p);
    if (inner?.status === "wrong") {
      anchor = p;
      return inner;
    }
    let cmp: CalcCheck = { status: "undecided" };
    if (mode === "simplify") {
      const before = anchor ? lastOf(anchor) : null;
      const now = firstOf(p);
      if (before && now) cmp = compareExpr(before, now);
      anchor = p;
    } else if (p.kind === "eq") {
      if (isIdentity(p) && (!anchor || (anchor.kind === "eq" && !isIdentity(anchor)))) {
        // a side calculation like 2(x-3) = 2x-6; the equation being solved stays the anchor
        return { status: "right", kind: "value" };
      }
      if (anchor?.kind === "eq") cmp = compareEquations(anchor.f, p.f);
      anchor = p;
    } else {
      // an expression or chain while solving an equation: a side calculation
      return inner ?? { status: "undecided" };
    }
    if (cmp.status === "wrong") return cmp;
    if (cmp.status === "right") return cmp;
    return inner ?? cmp;
  });
}

/** Whether the last step is the right final answer: against `expected` if given, else against the problem. */
export function verifyFinal(problem: string | undefined, steps: string[], expected?: string): boolean | null {
  const prob = parseProblem(problem);
  const mode = modeOf(prob);
  const lastText = steps.filter((x) => x.trim()).at(-1);
  if (!lastText) return null;
  const last = parseStep(lastText, mode);
  if (!last) return null;
  const decide = (c: CalcCheck) => (c.status === "right" ? true : c.status === "wrong" ? false : null);
  if (expected?.trim()) {
    if (mode === "simplify") {
      const exp = parseStep(expected, "simplify");
      const a = lastOf(last);
      const b = exp ? lastOf(exp) : null;
      return a && b ? decide(compareExpr(a, b)) : null;
    }
    if (last.kind !== "eq") return null;
    let exp = parseStep(expected, "solve");
    if (exp?.kind === "expr" && last.solvedFor) exp = parseStep(`${last.solvedFor} = ${expected}`, "solve");
    return exp?.kind === "eq" ? decide(compareEquations(exp.f, last.f)) : null;
  }
  if (!prob) return null;
  if (mode === "simplify") {
    const a = lastOf(prob);
    const b = lastOf(last);
    return a && b ? decide(compareExpr(a, b)) : null;
  }
  if (prob.kind !== "eq" || last.kind !== "eq" || !last.solvedFor) return null;
  return decide(compareEquations(prob.f, last.f));
}

/** Short display form: integers, simple fractions, else 4 decimals. */
export function formatNumber(x: number): string {
  if (Math.abs(x - Math.round(x)) < 1e-9) return String(Math.round(x));
  for (let q = 2; q <= 12; q++) {
    const p = Math.round(x * q);
    if (Math.abs(p / q - x) < 1e-9) return `${p}/${q}`;
  }
  return String(Number(x.toFixed(4)));
}
