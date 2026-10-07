import { err, t13 } from "./num";
import type { StatVals } from "./expr";

const median = (xs: number[]) => {
  const n = xs.length;
  if (!n) return NaN;
  const h = Math.floor(n / 2);
  return n % 2 ? xs[h] : (xs[h - 1] + xs[h]) / 2;
};

/** Weighted median for non-integer frequencies (cumulative weight). */
function weightedQuantile(pairs: [number, number][], p: number): number {
  const total = pairs.reduce((s, [, f]) => s + f, 0);
  let acc = 0;
  for (const [x, f] of pairs) {
    acc += f;
    if (acc >= total * p - 1e-12) return x;
  }
  return pairs[pairs.length - 1][0];
}

const r = (x: number) => t13(x);

export function oneVar(xs: number[], fs: number[] | null): StatVals {
  if (!xs.length) err("STAT");
  if (fs && fs.length !== xs.length) err("STAT");
  const f = fs ?? xs.map(() => 1);
  if (f.some((v) => v < 0 || v > 99)) err("FRQ DOMAIN");
  const n = f.reduce((a, b) => a + b, 0);
  if (n === 0) err("STAT");
  const sx = xs.reduce((s, x, i) => s + x * f[i], 0);
  const sx2 = xs.reduce((s, x, i) => s + x * x * f[i], 0);
  const mean = sx / n;
  const ss = xs.reduce((s, x, i) => s + f[i] * (x - mean) ** 2, 0);
  const intF = f.every((v) => Number.isInteger(v));
  const pairs = xs.map((x, i) => [x, f[i]] as [number, number]).filter(([, w]) => w > 0).sort((a, b) => a[0] - b[0]);
  let q1: number, med: number, q3: number;
  if (intF) {
    const all: number[] = [];
    for (const [x, w] of pairs) for (let k = 0; k < w; k++) all.push(x);
    const h = Math.floor(all.length / 2);
    med = median(all);
    q1 = all.length > 1 ? median(all.slice(0, h)) : all[0];
    q3 = all.length > 1 ? median(all.slice(all.length - h)) : all[0];
  } else {
    q1 = weightedQuantile(pairs, 0.25);
    med = weightedQuantile(pairs, 0.5);
    q3 = weightedQuantile(pairs, 0.75);
  }
  return {
    n: r(n),
    "x̄": r(mean),
    Sx: intF && n > 1 ? r(Math.sqrt(ss / (n - 1))) : "Error",
    σx: r(Math.sqrt(ss / n)),
    Σx: r(sx),
    "Σx²": r(sx2),
    minX: Math.min(...pairs.map((p) => p[0])),
    Q1: r(q1),
    Med: r(med),
    Q3: r(q3),
    maxX: Math.max(...pairs.map((p) => p[0])),
  };
}

export function twoVar(xs: number[], ys: number[]): StatVals {
  if (!xs.length || xs.length !== ys.length) err("STAT");
  const n = xs.length;
  const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
  const sx = sum(xs);
  const sy = sum(ys);
  const sx2 = sum(xs.map((x) => x * x));
  const sy2 = sum(ys.map((y) => y * y));
  const sxy = sum(xs.map((x, i) => x * ys[i]));
  const mx = sx / n;
  const my = sy / n;
  const sxx = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  const syy = ys.reduce((s, y) => s + (y - my) ** 2, 0);
  const sxyc = xs.reduce((s, x, i) => s + (x - mx) * (ys[i] - my), 0);
  const a = sxx === 0 ? NaN : sxyc / sxx;
  const b = my - a * mx;
  const rr = sxx === 0 || syy === 0 ? NaN : sxyc / Math.sqrt(sxx * syy);
  const val = (v: number) => (Number.isFinite(v) ? r(v) : "Error");
  return {
    n,
    "x̄": r(mx),
    Sx: n > 1 ? r(Math.sqrt(sxx / (n - 1))) : "Error",
    σx: r(Math.sqrt(sxx / n)),
    ȳ: r(my),
    Sy: n > 1 ? r(Math.sqrt(syy / (n - 1))) : "Error",
    σy: r(Math.sqrt(syy / n)),
    Σx: r(sx),
    "Σx²": r(sx2),
    Σy: r(sy),
    "Σy²": r(sy2),
    Σxy: r(sxy),
    a: val(a),
    b: val(b),
    r: val(rr),
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}
