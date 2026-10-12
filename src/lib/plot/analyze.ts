import type { Fn } from "./sample";

export type MarkerKind = "root" | "min" | "max" | "intersection" | "yIntercept";

export interface Marker {
  kind: MarkerKind;
  x: number;
  y: number;
  curve: number;
}

const MAX_PER_KIND = 12;

/** Roots of g in [a, b]: sign changes found on a grid, refined by bisection. Poles are rejected. */
export function findRoots(g: Fn, a: number, b: number, n = 600): number[] {
  const out: number[] = [];
  const h = (b - a) / n;
  let x0 = a;
  let y0 = g(x0);
  if (y0 === 0) out.push(x0);
  for (let i = 1; i <= n && out.length < MAX_PER_KIND; i++) {
    const x1 = a + i * h;
    const y1 = g(x1);
    if (y1 === 0 && Number.isFinite(y0)) out.push(x1);
    else if (Number.isFinite(y0) && Number.isFinite(y1) && y0 * y1 < 0) {
      let lo = x0;
      let hi = x1;
      let flo = y0;
      for (let k = 0; k < 60; k++) {
        const m = (lo + hi) / 2;
        const fm = g(m);
        if (!Number.isFinite(fm)) break;
        if (flo * fm <= 0) hi = m;
        else {
          lo = m;
          flo = fm;
        }
      }
      const r = (lo + hi) / 2;
      const scale = Math.max(Math.abs(y0), Math.abs(y1));
      if (Math.abs(g(r)) <= scale * 0.1 + 1e-9) out.push(r);
    }
    x0 = x1;
    y0 = y1;
  }
  return out;
}

/** Local extrema of f in [a, b], refined by ternary search around a sampled turn. */
export function findExtrema(f: Fn, a: number, b: number, n = 600): { x: number; y: number; kind: "min" | "max" }[] {
  const out: { x: number; y: number; kind: "min" | "max" }[] = [];
  const h = (b - a) / n;
  const ys: number[] = [];
  for (let i = 0; i <= n; i++) ys.push(f(a + i * h));
  for (let i = 1; i < n && out.length < MAX_PER_KIND; i++) {
    const p = ys[i - 1];
    const c = ys[i];
    const q = ys[i + 1];
    if (![p, c, q].every(Number.isFinite)) continue;
    const kind = c > p && c >= q ? "max" : c < p && c <= q ? "min" : null;
    if (!kind) continue;
    const sign = kind === "max" ? 1 : -1;
    let lo = a + (i - 1) * h;
    let hi = a + (i + 1) * h;
    for (let k = 0; k < 60; k++) {
      const m1 = lo + (hi - lo) / 3;
      const m2 = hi - (hi - lo) / 3;
      if (sign * f(m1) < sign * f(m2)) lo = m1;
      else hi = m2;
    }
    const x = (lo + hi) / 2;
    const y = f(x);
    // reject kinks that only look like turns because of a pole or jump
    if (Number.isFinite(y) && Math.abs(y - c) <= Math.abs(c) * 0.5 + (b - a)) out.push({ x, y, kind });
  }
  return out;
}

export function findIntersections(f: Fn, g: Fn, a: number, b: number): { x: number; y: number }[] {
  return findRoots((x) => f(x) - g(x), a, b).map((x) => ({ x, y: f(x) }));
}
