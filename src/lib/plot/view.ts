/** Centre plus world units per pixel, so resizing the canvas never distorts the plot. */
export interface View {
  cx: number;
  cy: number;
  sx: number;
  sy: number;
}

export interface Bounds {
  xmin: number;
  xmax: number;
  ymin: number;
  ymax: number;
}

export const MIN_SCALE = 1e-9;
export const MAX_SCALE = 1e9;

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function defaultView(w: number, half = 10): View {
  const s = (half * 2) / Math.max(1, w);
  return { cx: 0, cy: 0, sx: s, sy: s };
}

export function toBounds(v: View, w: number, h: number): Bounds {
  return { xmin: v.cx - (v.sx * w) / 2, xmax: v.cx + (v.sx * w) / 2, ymin: v.cy - (v.sy * h) / 2, ymax: v.cy + (v.sy * h) / 2 };
}

export function fromBounds(b: Bounds, w: number, h: number): View {
  return { cx: (b.xmin + b.xmax) / 2, cy: (b.ymin + b.ymax) / 2, sx: (b.xmax - b.xmin) / Math.max(1, w), sy: (b.ymax - b.ymin) / Math.max(1, h) };
}

export const worldX = (v: View, w: number, px: number) => v.cx + (px - w / 2) * v.sx;
export const worldY = (v: View, h: number, py: number) => v.cy - (py - h / 2) * v.sy;
export const screenX = (v: View, w: number, x: number) => (x - v.cx) / v.sx + w / 2;
export const screenY = (v: View, h: number, y: number) => h / 2 - (y - v.cy) / v.sy;

/** Drag by a pixel delta: the content follows the pointer. */
export function pan(v: View, dx: number, dy: number): View {
  return { ...v, cx: v.cx - dx * v.sx, cy: v.cy + dy * v.sy };
}

/** Scale by `factor` (>1 zooms in) keeping the world point under (px, py) fixed. */
export function zoomAt(v: View, factor: number, px: number, py: number, w: number, h: number): View {
  const wx = worldX(v, w, px);
  const wy = worldY(v, h, py);
  const sx = clamp(v.sx / factor, MIN_SCALE, MAX_SCALE);
  const sy = clamp(v.sy / factor, MIN_SCALE, MAX_SCALE);
  return { sx, sy, cx: wx - (px - w / 2) * sx, cy: wy + (py - h / 2) * sy };
}

export function zoomCentered(v: View, factor: number): View {
  return { ...v, sx: clamp(v.sx / factor, MIN_SCALE, MAX_SCALE), sy: clamp(v.sy / factor, MIN_SCALE, MAX_SCALE) };
}

/** Wheel delta to zoom factor; positive deltaY zooms out. */
export function wheelFactor(deltaY: number): number {
  return Math.exp(-clamp(deltaY, -400, 400) * 0.0015);
}

export function squareUp(v: View): View {
  const s = Math.max(v.sx, v.sy);
  return { ...v, sx: s, sy: s };
}

export function isValidView(v: View): boolean {
  return [v.cx, v.cy, v.sx, v.sy].every(Number.isFinite) && v.sx > 0 && v.sy > 0;
}
