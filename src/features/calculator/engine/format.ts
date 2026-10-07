import { type Q, type Val, findExact, isRational, t13 } from "./num";

export const findExactFor = (v: Val): Q | undefined => v.q ?? findExact(v.d);

export type Notation = "NORM" | "SCI" | "ENG";
export interface Fmt {
  notation: Notation;
  fix: number | null;
  mathprint: boolean;
}

/** Digits of a decimal as a string plus the power of ten of the first digit. */
interface Digits {
  neg: boolean;
  ds: string;
  e: number;
}

const NEG = "⁻";

function toDigits(x: number): Digits {
  const s = Math.abs(x).toExponential(12);
  const [m, e] = s.split("e");
  return { neg: x < 0, ds: m.replace(".", ""), e: Number(e) };
}

/** Round half away from zero to `n` significant digits. n may be ≤ 0. */
function roundSig(d: Digits, n: number): Digits {
  if (n <= 0) {
    if (n === 0 && d.ds[0] >= "5") return { neg: d.neg, ds: "1", e: d.e + 1 };
    return { neg: d.neg, ds: "0", e: d.e };
  }
  if (d.ds.length <= n) return { ...d, ds: d.ds.padEnd(n, "0") };
  const head = d.ds.slice(0, n).split("").map(Number);
  if (Number(d.ds[n]) >= 5) {
    let i = n - 1;
    while (i >= 0) {
      head[i]++;
      if (head[i] < 10) break;
      head[i] = 0;
      i--;
    }
    if (i < 0) return { neg: d.neg, ds: "1" + head.join(""), e: d.e + 1 };
  }
  return { neg: d.neg, ds: head.join(""), e: d.e };
}

const isZeroDigits = (d: Digits) => /^0*$/.test(d.ds);
const stripZeros = (s: string) => s.replace(/0+$/, "");

/** Fixed-point string of a digit set with `k` decimals; `strip` removes trailing zeros. */
function fixed(d: Digits, k: number, strip: boolean, trailingPoint: boolean): string {
  const r = roundSig(d, d.e + 1 + k);
  let intPart: string;
  let frac: string;
  if (isZeroDigits(r)) {
    intPart = "0";
    frac = "".padEnd(k, "0");
  } else if (r.e >= 0) {
    const all = r.ds.padEnd(r.e + 1 + k, "0");
    intPart = all.slice(0, r.e + 1);
    frac = all.slice(r.e + 1, r.e + 1 + k);
  } else {
    intPart = "0";
    frac = ("0".repeat(-r.e - 1) + r.ds).slice(0, k).padEnd(k, "0");
  }
  if (strip) frac = stripZeros(frac);
  const zero = isZeroDigits({ ...r, ds: intPart + frac });
  const sign = r.neg && !zero ? NEG : "";
  if (!frac) return sign + intPart + (trailingPoint ? "." : "");
  return sign + intPart + "." + frac;
}

function expo(e: number, style: "mp" | "cl" | "E"): string {
  const s = e < 0 ? NEG + String(-e) : String(e);
  if (style === "E") return "ᴇ" + s;
  return style === "mp" ? `*10^{${s}}` : `*10^${s}`;
}

function sci(d: Digits, fix: number | null, eng: boolean, style: "mp" | "cl" | "E"): string {
  if (isZeroDigits(d)) {
    const m = fix == null || fix === 0 ? "0" : "0." + "0".repeat(fix);
    return m + expo(0, style);
  }
  for (let pass = 0; pass < 2; pass++) {
    const e3 = eng ? Math.floor(d.e / 3) * 3 : d.e;
    const intDigits = d.e - e3 + 1;
    const expLen = String(Math.abs(e3)).length + (e3 < 0 ? 1 : 0);
    const max = Math.min(10, 12 - expLen);
    const n = fix == null ? max : Math.min(intDigits + fix, max);
    const r = roundSig(d, n);
    if (r.e !== d.e && pass === 0) {
      d = r;
      continue;
    }
    const all = r.ds.padEnd(intDigits, "0");
    const ip = all.slice(0, intDigits);
    let fp = all.slice(intDigits);
    if (fix == null) fp = stripZeros(fp);
    const m = fp ? `${ip}.${fp}` : ip;
    return (r.neg ? NEG : "") + m + expo(e3, style);
  }
  return "";
}

/** Format a decimal per the mode (BEHAVIOR §7). `restricted` uses ᴇ (menus, editor, table). */
export function formatDecimal(x: number, fmt: Fmt, restricted = false): string {
  const style = restricted ? "E" : fmt.mathprint ? "mp" : "cl";
  const d = toDigits(x);
  if (x === 0) d.ds = "0";
  if (fmt.notation !== "NORM") return sci(d, fmt.fix, fmt.notation === "ENG", style);
  if (x === 0) return fmt.fix == null ? "0" : fixed(d, fmt.fix, false, false);
  const r10 = roundSig(d, 10);
  if (r10.e >= 10) return sci(d, fmt.fix, false, style);
  if (fmt.fix != null) {
    const k = Math.min(fmt.fix, 9 - Math.max(r10.e, 0));
    return fixed(d, k, false, false);
  }
  if (r10.e >= 0) return fixed(d, 9 - r10.e, true, false);
  if (Math.abs(x) >= 1e-9) return fixed(d, 9, true, false);
  return sci(d, null, false, style);
}

/** Statistics menu values: 10 significant digits, trailing zeros removed (BEHAVIOR §16). */
export function formatSig10(x: number, fmt: Fmt): string {
  if (fmt.notation !== "NORM" || x === 0 || Math.abs(x) >= 1e10 || Math.abs(x) < 1e-9) return formatDecimal(x, fmt, true);
  const r = roundSig(toDigits(x), 10);
  return fixed(toDigits(x), Math.max(0, 9 - r.e), true, false);
}

/** Statistic and table values: as on Home, but rounded values keep trailing zeros, max `width` chars. */
export function formatFit(x: number, fmt: Fmt, width: number): string {
  if (fmt.notation !== "NORM") return formatDecimal(x, fmt, true);
  const home = formatDecimal(x, fmt, true);
  const d = toDigits(x);
  const exact = stripZeros(d.ds).length <= 10;
  if (home.includes("ᴇ")) return home;
  let s = home;
  if (!exact && fmt.fix == null) {
    const r10 = roundSig(d, 10);
    s = r10.e >= 0 ? fixed(d, 9 - r10.e, false, false) : fixed(d, 9, false, false);
  }
  while (s.length > width && s.includes(".")) {
    const k = s.length - s.indexOf(".") - 2;
    if (k < 0) break;
    s = fixed(d, k, exact || fmt.fix != null, false);
  }
  return s;
}

export function formatQ(q: Q, mathprint: boolean): string | undefined {
  const sign = q.n < 0 ? NEG : "";
  const a = Math.abs(q.n);
  if (q.r === 1 && q.pi === 0) {
    if (q.m === 1) return undefined;
    if (q.m >= 1000 || a >= 1e6) return undefined;
    return mathprint ? `${sign}\\f{${a}}{${q.m}}` : `${sign}${a}⁄${q.m}`;
  }
  if (!mathprint || q.m >= 1000 || a >= 1000 || q.r >= 1000 || (q.r > 1 && q.pi)) return undefined;
  const coef = a === 1 ? "" : String(a);
  const body = q.pi ? `${coef}π` : `${coef}√{${q.r}}`;
  return q.m === 1 ? sign + body : `${sign}\\f{${body}}{${q.m}}`;
}

export function formatMixed(q: Q, mathprint: boolean): string | undefined {
  if (q.r !== 1 || q.pi !== 0 || q.m === 1) return formatQ(q, mathprint);
  const sign = q.n < 0 ? NEG : "";
  const a = Math.abs(q.n);
  const w = Math.floor(a / q.m);
  const rem = a % q.m;
  if (w === 0) return formatQ(q, mathprint);
  return mathprint ? `${sign}${w}\\f{${rem}}{${q.m}}` : `${sign}${w}␣${rem}⁄${q.m}`;
}

export type Hint = "mixed" | "improper" | "fd" | "pct" | "dms" | "decimal" | "exact" | undefined;

export function formatDMS(x: number): string {
  const neg = x < 0;
  let a = Math.abs(x);
  let d = Math.floor(a + 1e-12);
  a = (a - d) * 60;
  let m = Math.floor(a + 1e-9);
  let s = Math.round((a - m) * 60);
  if (s >= 60) {
    s -= 60;
    m++;
  }
  if (m >= 60) {
    m -= 60;
    d++;
  }
  return `${neg ? NEG : ""}${d}°${m}'${s}"`;
}

/** Result markup for Home (BEHAVIOR §2 encoding). */
export function formatResult(v: Val, fmt: Fmt, opts: { hint?: Hint; usedFrac?: boolean } = {}): string {
  const { hint } = opts;
  if (hint === "dms") return formatDMS(v.d);
  if (hint === "pct") return formatDecimal(t13(v.d * 100), fmt) + "%";
  if (hint === "decimal") return formatDecimal(v.d, fmt);
  if (hint === "improper" && v.q) return formatQ(v.q, fmt.mathprint) ?? formatDecimal(v.d, fmt);
  if (hint === "mixed") {
    const q = v.q ?? findExact(v.d, { rationalOnly: true });
    if (q) {
      const s = formatMixed(q, fmt.mathprint);
      if (s) return s;
    }
    return formatDecimal(v.d, fmt);
  }
  if (hint === "fd" || hint === "exact") {
    if (hint === "fd" && v.q && isRational(v) && v.q.m !== 1) return formatDecimal(v.d, fmt);
    const q = v.q && (hint === "exact" || isRational(v)) ? v.q : findExact(v.d, { rationalOnly: hint === "fd" });
    if (q) {
      const s = formatQ(q, fmt.mathprint);
      if (s) return s;
    }
    return formatDecimal(v.d, fmt);
  }
  if (v.q) {
    const rational = isRational(v);
    const allowed = fmt.mathprint
      ? !(rational && fmt.notation !== "NORM")
      : rational && !!opts.usedFrac && fmt.notation === "NORM";
    if (allowed) {
      const s = formatQ(v.q, fmt.mathprint);
      if (s) return s;
    }
  }
  return formatDecimal(v.d, fmt);
}

/** The full stored value, as pasted into an entry (toggle, ▸DMS, history). */
export function fullDecimal(x: number): string {
  if (x === 0) return "0";
  const d = toDigits(x);
  const ds = stripZeros(d.ds) || "0";
  const sign = d.neg ? NEG : "";
  if (d.e >= 13 || d.e < -13) {
    const m = ds.length > 1 ? `${ds[0]}.${ds.slice(1)}` : ds;
    return `${sign}${m}*10^{${d.e < 0 ? NEG + -d.e : d.e}}`;
  }
  if (d.e >= 0) {
    const ip = ds.padEnd(d.e + 1, "0").slice(0, d.e + 1);
    const fp = ds.slice(d.e + 1);
    return sign + ip + (fp ? "." + fp : "");
  }
  return sign + "0." + "0".repeat(-d.e - 1) + ds;
}

/** Value text in restricted screens (recall menu, data editor edit line). */
export function formatPlain(v: Val, fmt: Fmt): string {
  if (v.q && isRational(v) && v.q.m !== 1 && v.q.m < 1000) {
    return `${v.q.n < 0 ? NEG : ""}${Math.abs(v.q.n)}/${v.q.m}`;
  }
  return formatDecimal(v.d, fmt, true);
}
