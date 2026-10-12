import type { PlotTheme } from "../../../lib/plot/draw";

export const PLOT_COLORS = 6;

export function cssVar(el: Element, name: string): string {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

export function plotColor(el: Element, i: number): string {
  return cssVar(el, `--plot-${(i % PLOT_COLORS) + 1}`);
}

export function readPlotTheme(el: Element): PlotTheme {
  return {
    bg: cssVar(el, "--surface"),
    grid: cssVar(el, "--border"),
    gridMinor: cssVar(el, "--divider"),
    axis: cssVar(el, "--text-muted"),
    label: cssVar(el, "--text-muted"),
    halo: cssVar(el, "--surface"),
    font: `11px ${getComputedStyle(el).fontFamily}`,
  };
}

export function readLcdTheme(el: Element): PlotTheme {
  const ink = cssVar(el, "--calc-lcd-ink");
  const bg = cssVar(el, "--calc-lcd");
  return { bg, grid: ink, gridMinor: ink, axis: ink, label: ink, halo: bg, font: `10px ${getComputedStyle(el).fontFamily}` };
}

/** Reports an element's size in CSS pixels now and whenever it changes. */
export function observeSize(el: Element, cb: (w: number, h: number) => void): () => void {
  const update = () => cb(el.clientWidth, el.clientHeight);
  update();
  const ro = new ResizeObserver(update);
  ro.observe(el);
  return () => ro.disconnect();
}

export function fitCanvas(canvas: HTMLCanvasElement, w: number, h: number): CanvasRenderingContext2D | null {
  const dpr = window.devicePixelRatio || 1;
  const pw = Math.max(1, Math.round(w * dpr));
  const ph = Math.max(1, Math.round(h * dpr));
  if (canvas.width !== pw) canvas.width = pw;
  if (canvas.height !== ph) canvas.height = ph;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}
