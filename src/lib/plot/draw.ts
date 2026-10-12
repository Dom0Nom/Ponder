import type { Marker } from "./analyze";
import type { Segment } from "./sample";
import { formatTick, niceStep, ticks } from "./ticks";
import { screenX, screenY, toBounds, type View } from "./view";

export interface PlotTheme {
  bg: string;
  grid: string;
  gridMinor: string;
  axis: string;
  label: string;
  halo: string;
  font: string;
}

export interface DrawCurve {
  segments: Segment[];
  color: string;
  width: number;
}

export interface DrawOptions {
  w: number;
  h: number;
  view: View;
  theme: PlotTheme;
  curves: DrawCurve[];
  markers?: { marker: Marker; color: string }[];
  trace?: { x: number; y: number; color: string } | null;
  /** Tick spacing in world units; derived from the view when absent. */
  xStep?: number;
  yStep?: number;
  grid?: boolean;
  labels?: boolean;
  /** Small marks on the axes at each step (instead of grid lines). */
  tickMarks?: boolean;
}

const LIMIT = 1e5;
const lim = (v: number) => Math.max(-LIMIT, Math.min(LIMIT, v));

export function autoSteps(view: View, w: number, h: number): { xStep: number; yStep: number } {
  const b = toBounds(view, w, h);
  return { xStep: niceStep((b.xmax - b.xmin) / Math.max(2, w / 90)), yStep: niceStep((b.ymax - b.ymin) / Math.max(2, h / 70)) };
}

function minorOf(step: number): number {
  const m = step / Math.pow(10, Math.floor(Math.log10(step)));
  return step / (Math.round(m) === 2 ? 4 : 5);
}

export function drawPlot(ctx: CanvasRenderingContext2D, o: DrawOptions): void {
  const { w, h, view, theme } = o;
  const b = toBounds(view, w, h);
  const auto = autoSteps(view, w, h);
  const xStep = o.xStep ?? auto.xStep;
  const yStep = o.yStep ?? auto.yStep;
  const sx = (x: number) => lim(screenX(view, w, x));
  const sy = (y: number) => lim(screenY(view, h, y));
  const crisp = (v: number) => Math.round(v) + 0.5;

  ctx.fillStyle = theme.bg;
  ctx.fillRect(0, 0, w, h);

  const line = (x0: number, y0: number, x1: number, y1: number) => {
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
  };

  if (o.grid !== false) {
    const minX = o.xStep ? 0 : minorOf(xStep);
    const minY = o.yStep ? 0 : minorOf(yStep);
    ctx.lineWidth = 1;
    if (minX && minX / view.sx >= 8 && minY && minY / view.sy >= 8) {
      ctx.strokeStyle = theme.gridMinor;
      ctx.beginPath();
      for (const t of ticks(b.xmin, b.xmax, minX)) line(crisp(sx(t)), 0, crisp(sx(t)), h);
      for (const t of ticks(b.ymin, b.ymax, minY)) line(0, crisp(sy(t)), w, crisp(sy(t)));
      ctx.stroke();
    }
    ctx.strokeStyle = theme.grid;
    ctx.beginPath();
    for (const t of ticks(b.xmin, b.xmax, xStep)) line(crisp(sx(t)), 0, crisp(sx(t)), h);
    for (const t of ticks(b.ymin, b.ymax, yStep)) line(0, crisp(sy(t)), w, crisp(sy(t)));
    ctx.stroke();
  }

  const ax = sx(0);
  const ay = sy(0);
  ctx.strokeStyle = theme.axis;
  ctx.lineWidth = 1.25;
  ctx.beginPath();
  if (b.xmin <= 0 && b.xmax >= 0) line(crisp(ax), 0, crisp(ax), h);
  if (b.ymin <= 0 && b.ymax >= 0) line(0, crisp(ay), w, crisp(ay));
  ctx.stroke();

  if (o.tickMarks) {
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (const t of ticks(b.xmin, b.xmax, xStep)) line(crisp(sx(t)), ay - 3, crisp(sx(t)), ay + 4);
    for (const t of ticks(b.ymin, b.ymax, yStep)) line(ax - 3, crisp(sy(t)), ax + 4, crisp(sy(t)));
    ctx.stroke();
  }

  if (o.labels !== false) {
    ctx.font = theme.font;
    ctx.lineJoin = "round";
    ctx.lineWidth = 3;
    ctx.strokeStyle = theme.halo;
    ctx.fillStyle = theme.label;
    const text = (s: string, x: number, y: number, align: CanvasTextAlign, base: CanvasTextBaseline) => {
      ctx.textAlign = align;
      ctx.textBaseline = base;
      ctx.strokeText(s, x, y);
      ctx.fillText(s, x, y);
    };
    const axisY = Math.max(4, Math.min(h - 16, ay + 4));
    const axisX = Math.max(30, Math.min(w - 4, ax - 5));
    for (const t of ticks(b.xmin, b.xmax, xStep)) {
      if (Math.abs(t) < xStep * 1e-9) continue;
      text(formatTick(t, xStep), sx(t), axisY, "center", "top");
    }
    for (const t of ticks(b.ymin, b.ymax, yStep)) {
      if (Math.abs(t) < yStep * 1e-9) continue;
      text(formatTick(t, yStep), axisX, sy(t), "right", "middle");
    }
    if (b.xmin <= 0 && b.xmax >= 0 && b.ymin <= 0 && b.ymax >= 0) text("0", ax - 5, ay + 4, "right", "top");
  }

  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const c of o.curves) {
    ctx.strokeStyle = c.color;
    ctx.lineWidth = c.width;
    ctx.beginPath();
    for (const seg of c.segments) {
      ctx.moveTo(sx(seg[0]), sy(seg[1]));
      if (seg.length === 2) ctx.lineTo(sx(seg[0]) + 0.01, sy(seg[1]));
      for (let i = 2; i < seg.length; i += 2) ctx.lineTo(sx(seg[i]), sy(seg[i + 1]));
    }
    ctx.stroke();
  }

  for (const { marker, color } of o.markers ?? []) {
    const x = sx(marker.x);
    const y = sy(marker.y);
    if (x < -8 || x > w + 8 || y < -8 || y > h + 8) continue;
    ctx.beginPath();
    ctx.arc(x, y, 4, 0, Math.PI * 2);
    ctx.fillStyle = theme.bg;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.stroke();
  }

  if (o.trace) {
    const x = sx(o.trace.x);
    const y = sy(o.trace.y);
    ctx.beginPath();
    ctx.arc(x, y, 5, 0, Math.PI * 2);
    ctx.fillStyle = o.trace.color;
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = theme.bg;
    ctx.stroke();
  }
}
