import type { ChartSpec } from "../questions/types";
import { formatTick, tickStep, ticks } from "./ticks";

export interface ChartMark {
  series: number;
  /** pixel box (bars) or centre (points) */
  x: number;
  y: number;
  w?: number;
  h?: number;
  label: string;
}

export interface ChartLayout {
  width: number;
  height: number;
  plot: { x: number; y: number; w: number; h: number };
  yTicks: { v: number; y: number; label: string }[];
  xTicks: { x: number; label: string }[];
  marks: ChartMark[];
  /** polyline per series (line charts) */
  lines: { series: number; points: [number, number][] }[];
  series: string[];
  /** data -> pixel, for hotspots */
  toPx: (x: number, y: number) => [number, number];
  fromPx: (px: number, py: number) => [number, number];
}

const PAD = { l: 44, r: 12, t: 12, b: 34 };

function extent(values: number[], zero: boolean): [number, number] {
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (zero) lo = Math.min(0, lo);
  if (lo === hi) hi = lo + 1;
  const step = tickStep(lo, hi, 5);
  return [Math.floor(lo / step) * step, Math.ceil(hi / step) * step];
}

/** Pure geometry for bar, line and scatter charts from data; the SVG component only draws it. */
export function layoutChart(spec: ChartSpec, width = 420, height = 240): ChartLayout {
  const plot = { x: PAD.l, y: PAD.t, w: width - PAD.l - PAD.r, h: height - PAD.t - PAD.b };
  const series = spec.series.map((s) => s.name);
  const marks: ChartMark[] = [];
  const lines: ChartLayout["lines"] = [];
  let xTicks: ChartLayout["xTicks"] = [];
  let xMin = 0;
  let xMax = 1;
  let yMin: number;
  let yMax: number;

  if (spec.type === "scatter") {
    const pts = spec.series.flatMap((s) => s.points);
    [xMin, xMax] = extent(pts.map((p) => p[0]), false);
    [yMin, yMax] = extent(pts.map((p) => p[1]), false);
    const xs = tickStep(xMin, xMax, 6);
    xTicks = ticks(xMin, xMax, xs).map((v) => ({ x: plot.x + ((v - xMin) / (xMax - xMin)) * plot.w, label: formatTick(v, xs) }));
  } else {
    [yMin, yMax] = extent(spec.series.flatMap((s) => s.values), spec.type === "bar");
  }
  const sy = (v: number) => plot.y + plot.h - ((v - yMin) / (yMax - yMin)) * plot.h;
  const ys = tickStep(yMin, yMax, 5);
  const yTicks = ticks(yMin, yMax, ys).map((v) => ({ v, y: sy(v), label: formatTick(v, ys) }));

  if (spec.type === "scatter") {
    const sx = (v: number) => plot.x + ((v - xMin) / (xMax - xMin)) * plot.w;
    spec.series.forEach((s, si) => s.points.forEach(([px, py]) => marks.push({ series: si, x: sx(px), y: sy(py), label: `${s.name} (${px}, ${py})` })));
    return {
      width,
      height,
      plot,
      yTicks,
      xTicks,
      marks,
      lines,
      series,
      toPx: (x, y) => [sx(x), sy(y)],
      fromPx: (px, py) => [xMin + ((px - plot.x) / plot.w) * (xMax - xMin), yMin + ((plot.y + plot.h - py) / plot.h) * (yMax - yMin)],
    };
  }

  const n = spec.categories.length;
  const band = plot.w / n;
  const k = spec.series.length;
  xTicks = spec.categories.map((c, i) => ({ x: plot.x + band * (i + 0.5), label: c }));
  if (spec.type === "bar") {
    const inner = band * 0.7;
    const bw = inner / k;
    spec.series.forEach((s, si) =>
      s.values.forEach((v, i) => {
        const x = plot.x + band * i + (band - inner) / 2 + bw * si;
        const y0 = sy(0);
        const y1 = sy(v);
        marks.push({ series: si, x, y: Math.min(y0, y1), w: bw, h: Math.abs(y0 - y1), label: `${spec.categories[i]}: ${v}` });
      }),
    );
  } else {
    spec.series.forEach((s, si) => {
      const pts = s.values.map((v, i) => [plot.x + band * (i + 0.5), sy(v)] as [number, number]);
      lines.push({ series: si, points: pts });
      pts.forEach(([x, y], i) => marks.push({ series: si, x, y, label: `${spec.categories[i]}: ${s.values[i]}` }));
    });
  }
  return {
    width,
    height,
    plot,
    yTicks,
    xTicks,
    marks,
    lines,
    series,
    toPx: (x, y) => [plot.x + band * (x + 0.5), sy(y)],
    fromPx: (px, py) => [(px - plot.x) / band - 0.5, yMin + ((plot.y + plot.h - py) / plot.h) * (yMax - yMin)],
  };
}
