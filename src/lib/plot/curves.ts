import { parseEquation, type AngleMode, type Compiled, type ParseError } from "./parser";
import { sampleFn, sampleVertical, type Sampled } from "./sample";
import type { Bounds } from "./view";

export type Curve =
  | { kind: "empty" }
  | { kind: "error"; error: ParseError }
  | { kind: "y"; compiled: Compiled; f: (x: number) => number }
  | { kind: "x"; value: number };

export function buildCurve(src: string, angle: AngleMode): Curve {
  if (!src.trim()) return { kind: "empty" };
  const r = parseEquation(src, angle);
  if (!r.ok) return { kind: "error", error: r.error };
  if (r.value.kind === "x") return { kind: "x", value: r.value.value };
  const env = { x: 0, ans: 0 };
  const run = r.value.compiled.eval;
  return {
    kind: "y",
    compiled: r.value.compiled,
    f: (x) => {
      env.x = x;
      return run(env);
    },
  };
}

export function isDrawable(c: Curve): c is Extract<Curve, { kind: "y" | "x" }> {
  return c.kind === "y" || c.kind === "x";
}

export function sampleCurve(c: Curve, b: Bounds, widthPx: number, heightPx: number): Sampled {
  if (c.kind === "y") return sampleFn(c.f, b.xmin, b.xmax, widthPx, (b.ymax - b.ymin) / Math.max(1, heightPx));
  if (c.kind === "x") return c.value >= b.xmin && c.value <= b.xmax ? sampleVertical(c.value, b.ymin, b.ymax) : { segments: [], points: 0 };
  return { segments: [], points: 0 };
}

/** y at x for a curve, NaN where it is undefined or not a function of x. */
export function valueAt(c: Curve, x: number): number {
  return c.kind === "y" ? c.f(x) : NaN;
}

/** Smallest and largest finite y of the curves over [xmin, xmax], for fit-to-curves. */
export function yRange(curves: Curve[], xmin: number, xmax: number, n = 400): { ymin: number; ymax: number } | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (const c of curves) {
    if (c.kind !== "y") continue;
    for (let i = 0; i <= n; i++) {
      const y = c.f(xmin + ((xmax - xmin) * i) / n);
      if (Number.isFinite(y)) {
        lo = Math.min(lo, y);
        hi = Math.max(hi, y);
      }
    }
  }
  return lo <= hi ? { ymin: lo, ymax: hi } : null;
}
