export type ErrCode =
  | "ARGUMENT"
  | "DIVIDE BY 0"
  | "DOMAIN"
  | "EQUATION LENGTH ERROR"
  | "FRQ DOMAIN"
  | "OVERFLOW"
  | "STAT"
  | "DIM MISMATCH"
  | "FORMULA"
  | "SYNTAX"
  | "INVALID FUNCTION"
  | "MEMORY LIMIT";

export class CalcError extends Error {
  /** Entry index the cursor goes to when the error screen is cleared (BEHAVIOR §21). */
  constructor(
    public code: ErrCode,
    public pos?: number,
    /** The failing operation is a power template: the cursor goes to the end of its exponent. */
    public inSlot?: boolean,
  ) {
    super(code);
  }
}

export const err = (code: ErrCode): never => {
  throw new CalcError(code);
};

/** Exact value (n/m)·√r·π^pi with gcd(n,m)=1, m>0, r squarefree. */
export interface Q {
  n: number;
  m: number;
  r: number;
  pi: number;
}

/** A calculator value: `d` is the 13-digit decimal, `q` the exact form when one is known. */
export interface Val {
  d: number;
  q?: Q;
}

export const PI13 = 3.14159265359;
export const E13 = 2.718281828459;
const LIM = 1e15;

const safe = (...xs: number[]) => xs.every((x) => Number.isSafeInteger(x) && Math.abs(x) < LIM);

export function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}

function digits15(x: number): { neg: boolean; ds: string; e: number } {
  const s = Math.abs(x).toExponential(14);
  const [mant, ex] = s.split("e");
  return { neg: x < 0, ds: mant.replace(".", ""), e: Number(ex) };
}

function checkRange(x: number): number {
  if (!Number.isFinite(x) || Math.abs(x) >= 1e100) err("OVERFLOW");
  if (Math.abs(x) < 1e-99) return 0;
  return x;
}

/** Truncate an arithmetic result to 13 significant digits (the device's internal precision). */
export function t13(x: number): number {
  x = checkRange(x);
  if (x === 0) return 0;
  const { neg, ds, e } = digits15(x);
  const kept = ds.slice(0, 13);
  const v = Number(`${kept[0]}.${kept.slice(1)}e${e}`);
  return checkRange(neg ? -v : v);
}

/** Round to 13 significant digits (used when an exact value gets its decimal form). */
export function r13(x: number): number {
  x = checkRange(x);
  if (x === 0) return 0;
  return checkRange(Number(x.toPrecision(13)));
}

export function normQ(n: number, m: number, r = 1, pi = 0): Q | undefined {
  if (!safe(n, m, r) || m === 0 || r < 0 || pi < 0 || pi > 1) return undefined;
  if (m < 0) {
    n = -n;
    m = -m;
  }
  if (r === 0 || n === 0) return { n: 0, m: 1, r: 1, pi: 0 };
  for (let i = 2; i * i <= r; i++) {
    while (r % (i * i) === 0) {
      r /= i * i;
      n *= i;
    }
  }
  if (!safe(n)) return undefined;
  const g = gcd(n, m);
  return { n: n / g, m: m / g, r, pi };
}

export const qValue = (q: Q) => (q.n / q.m) * Math.sqrt(q.r) * (q.pi ? PI13 : 1);

export function fromQ(q: Q | undefined, fallback?: number): Val {
  if (!q) return { d: t13(fallback ?? NaN) };
  return { d: r13(qValue(q)), q };
}

export const int = (n: number): Val =>
  Number.isSafeInteger(n) && Math.abs(n) < LIM ? { d: r13(n), q: { n, m: 1, r: 1, pi: 0 } } : { d: t13(n) };
export const dec = (x: number): Val => ({ d: t13(x) });
export const ZERO = int(0);
export const PI: Val = { d: PI13, q: { n: 1, m: 1, r: 1, pi: 1 } };

/** Division and percent give decimals unless the result is a whole number (BEHAVIOR §7.4). */
export const decimal = (v: Val): Val => (v.q && !(v.q.r === 1 && v.q.pi === 0 && v.q.m === 1) ? { d: v.d } : v);

export const isRational = (v: Val) => !!v.q && v.q.r === 1 && v.q.pi === 0;
export const isInteger = (v: Val) => (v.q ? isRational(v) && v.q.m === 1 : Number.isInteger(v.d));
export const isZero = (v: Val) => v.d === 0;

export function add(a: Val, b: Val): Val {
  if (a.q && b.q) {
    if (a.q.n === 0) return b;
    if (b.q.n === 0) return a;
    if (a.q.r === b.q.r && a.q.pi === b.q.pi) {
      const q = normQ(a.q.n * b.q.m + b.q.n * a.q.m, a.q.m * b.q.m, a.q.r, a.q.pi);
      if (q) return fromQ(q);
    }
  }
  return dec(a.d + b.d);
}

export const neg = (a: Val): Val => ({ d: -a.d, q: a.q ? { ...a.q, n: -a.q.n } : undefined });
export const sub = (a: Val, b: Val) => add(a, neg(b));

export function mul(a: Val, b: Val): Val {
  if (a.q && b.q) {
    if (a.q.n === 0 || b.q.n === 0) return ZERO;
    const q = normQ(a.q.n * b.q.n, a.q.m * b.q.m, a.q.r * b.q.r, a.q.pi + b.q.pi);
    if (q) return fromQ(q);
  }
  return dec(a.d * b.d);
}

export function div(a: Val, b: Val): Val {
  if (b.d === 0) err("DIVIDE BY 0");
  if (a.q && b.q) {
    const q = normQ(a.q.n * b.q.m, a.q.m * b.q.n * b.q.r, a.q.r * b.q.r, a.q.pi - b.q.pi);
    if (q) return fromQ(q);
  }
  return dec(a.d / b.d);
}

function ipow(a: Val, k: number): Val {
  if (k < 0) return div(int(1), ipow(a, -k));
  let r = int(1);
  let base = a;
  while (k > 0) {
    if (k & 1) r = mul(r, base);
    k >>= 1;
    if (k) base = mul(base, base);
  }
  return r;
}

export function pow(a: Val, b: Val): Val {
  if (a.d === 0) {
    if (b.d === 0) err("DOMAIN");
    if (b.d < 0) err("DOMAIN");
    return ZERO;
  }
  if (a.q && isInteger(b) && b.q && Math.abs(b.q.n) <= 400) {
    const r = ipow(a, b.q.n);
    return r.q ? r : dec(Math.pow(a.d, b.d));
  }
  if (a.d < 0 && !Number.isInteger(b.d)) err("DOMAIN");
  return dec(Math.pow(a.d, b.d));
}

export function sqrt(a: Val): Val {
  if (a.d < 0) err("DOMAIN");
  if (a.q && isRational(a) && a.q.m === 1) {
    const q = normQ(1, 1, a.q.n);
    if (q) return fromQ(q);
  }
  return dec(Math.sqrt(a.d));
}

function intRoot(x: number, k: number): number | undefined {
  const r = Math.round(Math.pow(x, 1 / k));
  for (const c of [r - 1, r, r + 1]) if (c >= 0 && Math.pow(c, k) === x) return c;
  return undefined;
}

export function root(idx: Val, x: Val): Val {
  const k = idx.d;
  if (k === 0) err("DOMAIN");
  const oddInt = Number.isInteger(k) && Math.abs(k) % 2 === 1;
  if (x.d < 0 && !oddInt) err("DOMAIN");
  if (isInteger(idx) && k > 0 && x.q && isRational(x)) {
    const rn = intRoot(Math.abs(x.q.n), k);
    const rm = intRoot(x.q.m, k);
    if (rn !== undefined && rm !== undefined) return fromQ(normQ(x.q.n < 0 ? -rn : rn, rm));
  }
  const v = Math.pow(Math.abs(x.d), 1 / k);
  return dec(x.d < 0 ? -v : v);
}

export function factorial(a: Val): Val {
  const n = a.d;
  if (!Number.isInteger(n) || n < 0) err("DOMAIN");
  if (n > 69) err("OVERFLOW");
  let r = 1;
  for (let i = 2; i <= n; i++) r *= i;
  return int(r);
}

function checkPerm(n: Val, r: Val) {
  if (!Number.isInteger(n.d) || !Number.isInteger(r.d) || n.d < 0 || r.d < 0) err("DOMAIN");
}

export function nPr(n: Val, r: Val): Val {
  checkPerm(n, r);
  if (r.d > n.d) return ZERO;
  let v = 1;
  for (let i = 0; i < r.d; i++) v *= n.d - i;
  return int(v);
}

export function nCr(n: Val, r: Val): Val {
  checkPerm(n, r);
  if (r.d > n.d) return ZERO;
  const k = Math.min(r.d, n.d - r.d);
  let v = 1;
  for (let i = 1; i <= k; i++) v = (v * (n.d - k + i)) / i;
  return int(Math.round(v));
}

export function log10(a: Val): Val {
  if (a.d <= 0) err("DOMAIN");
  if (a.q && isRational(a)) {
    const p = (x: number) => {
      let e = 0;
      while (x > 1 && x % 10 === 0) {
        x /= 10;
        e++;
      }
      return x === 1 ? e : undefined;
    };
    if (a.q.m === 1 && p(a.q.n) !== undefined) return int(p(a.q.n)!);
    if (a.q.n === 1 && p(a.q.m) !== undefined) return int(-p(a.q.m)!);
  }
  return dec(Math.log10(a.d));
}

export function ln(a: Val): Val {
  if (a.d <= 0) err("DOMAIN");
  if (a.q && isRational(a) && a.q.n === 1 && a.q.m === 1) return ZERO;
  return dec(Math.log(a.d));
}

export function exp(a: Val): Val {
  if (a.q && a.q.n === 0) return int(1);
  return dec(Math.exp(a.d));
}

/** Find a simple exact form for a decimal (answer toggle, ▸F◂▸d). */
export function findExact(d: number, opts: { rationalOnly?: boolean } = {}): Q | undefined {
  if (d === 0) return { n: 0, m: 1, r: 1, pi: 0 };
  const near = (x: number) => Math.abs(x - Math.round(x)) < 1e-9 * Math.max(1, Math.abs(x));
  for (let m = 1; m < 1000; m++) {
    const n = d * m;
    if (Math.abs(n) < 1e9 && near(n)) return normQ(Math.round(n), m);
  }
  if (opts.rationalOnly) return undefined;
  const p = d / PI13;
  for (let m = 1; m < 100; m++) {
    const n = p * m;
    if (Math.abs(n) < 1000 && near(n)) return normQ(Math.round(n), m, 1, 1);
  }
  return undefined;
}
