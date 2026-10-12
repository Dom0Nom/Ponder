export type Fn = (x: number) => number;

/** Flat [x0, y0, x1, y1, ...] runs of continuous, finite points in world coordinates. */
export type Segment = number[];

export interface Sampled {
  segments: Segment[];
  /** Number of finite points sampled. */
  points: number;
}

const ok = (y: number) => Number.isFinite(y);

/**
 * Sample f over [xmin, xmax] at about `step` pixels; `yPerPx` is world units per vertical pixel. Undefined values split a curve;
 * a jump that stays large when the interval is bisected (asymptotes, steps) also splits it,
 * while a merely steep part gets extra points instead.
 */
export function sampleFn(f: Fn, xmin: number, xmax: number, widthPx: number, yPerPx: number, step = 1): Sampled {
  const n = Math.max(2, Math.ceil(widthPx / step));
  const dx = (xmax - xmin) / n;
  const big = yPerPx * 8;
  let budget = 30000;
  const segments: Segment[] = [];
  let cur: Segment = [];
  let points = 0;

  const flush = () => {
    if (cur.length >= 2) segments.push(cur);
    cur = [];
  };

  const refine = (x0: number, y0: number, x1: number, y1: number, depth: number): boolean => {
    if (Math.abs(y1 - y0) <= big) return true;
    if (depth === 0) return Math.abs(y1 - y0) <= yPerPx * 4;
    if (budget-- <= 0) return false;
    const xm = (x0 + x1) / 2;
    const ym = f(xm);
    if (!ok(ym)) return false;
    if (!refine(x0, y0, xm, ym, depth - 1)) return false;
    cur.push(xm, ym);
    return refine(xm, ym, x1, y1, depth - 1);
  };

  let px = 0;
  let py = NaN;
  for (let i = 0; i <= n; i++) {
    const x = xmin + i * dx;
    const y = f(x);
    if (!ok(y)) {
      flush();
      py = NaN;
      continue;
    }
    points++;
    if (ok(py) && Math.abs(y - py) > big) {
      const mark = cur.length;
      if (!refine(px, py, x, y, 12)) {
        cur.length = mark;
        flush();
      }
    }
    cur.push(x, y);
    px = x;
    py = y;
  }
  flush();
  return { segments, points };
}

/** Vertical line x = c as a single segment spanning the view. */
export function sampleVertical(c: number, ymin: number, ymax: number): Sampled {
  return { segments: [[c, ymin, c, ymax]], points: 2 };
}
