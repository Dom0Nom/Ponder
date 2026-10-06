import type { Card, OcclusionMask } from "../types";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface Point {
  x: number;
  y: number;
}
export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";
export const HANDLES: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/** Smallest mask side, as a fraction of the image. */
export const MIN_SIZE = 0.02;

export const clamp01 = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

/** Rectangle spanned by two points (any drag direction), clipped to the image. */
export function rectFromPoints(a: Point, b: Point): Rect {
  const x0 = clamp01(Math.min(a.x, b.x));
  const y0 = clamp01(Math.min(a.y, b.y));
  const x1 = clamp01(Math.max(a.x, b.x));
  const y1 = clamp01(Math.max(a.y, b.y));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Flips negative sizes, caps the size at the image and moves the rect inside it. */
export function normalizeRect(r: Rect): Rect {
  let { x, y, w, h } = r;
  if (w < 0) [x, w] = [x + w, -w];
  if (h < 0) [y, h] = [y + h, -h];
  w = clamp01(w);
  h = clamp01(h);
  return { x: Math.min(clamp01(x), 1 - w), y: Math.min(clamp01(y), 1 - h), w, h };
}

export const isBigEnough = (r: Rect, min = MIN_SIZE) => r.w >= min && r.h >= min;

/** Topmost mask (last drawn) containing the point. */
export function maskAt<T extends Rect & { id: string }>(masks: T[], p: Point): T | null {
  for (let i = masks.length - 1; i >= 0; i--) {
    const m = masks[i];
    if (p.x >= m.x && p.x <= m.x + m.w && p.y >= m.y && p.y <= m.y + m.h) return m;
  }
  return null;
}

/** Resize handle under the point; `tol` is the grab distance per axis in image fractions. */
export function handleAt(r: Rect, p: Point, tol: Point): Handle | null {
  const near = (v: number, t: number, target: number) => Math.abs(v - target) <= t;
  const inX = p.x >= r.x - tol.x && p.x <= r.x + r.w + tol.x;
  const inY = p.y >= r.y - tol.y && p.y <= r.y + r.h + tol.y;
  if (!inX || !inY) return null;
  const n = near(p.y, tol.y, r.y);
  const s = near(p.y, tol.y, r.y + r.h);
  const w = near(p.x, tol.x, r.x);
  const e = near(p.x, tol.x, r.x + r.w);
  const midX = near(p.x, tol.x, r.x + r.w / 2);
  const midY = near(p.y, tol.y, r.y + r.h / 2);
  if (n && w) return "nw";
  if (n && e) return "ne";
  if (s && w) return "sw";
  if (s && e) return "se";
  if (n && midX) return "n";
  if (s && midX) return "s";
  if (w && midY) return "w";
  if (e && midY) return "e";
  return null;
}

/** Moves a rect by (dx, dy), keeping it fully on the image. */
export function moveRect(r: Rect, dx: number, dy: number): Rect {
  return {
    ...r,
    x: Math.min(Math.max(0, r.x + dx), 1 - r.w),
    y: Math.min(Math.max(0, r.y + dy), 1 - r.h),
  };
}

/** Drags one edge or corner; the opposite side stays put and the size never drops below `min`. */
export function resizeRect(r: Rect, handle: Handle, dx: number, dy: number, min = MIN_SIZE): Rect {
  let left = r.x;
  let top = r.y;
  let right = r.x + r.w;
  let bottom = r.y + r.h;
  if (handle.includes("w")) left = Math.min(Math.max(0, left + dx), right - min);
  if (handle.includes("e")) right = Math.max(Math.min(1, right + dx), left + min);
  if (handle.includes("n")) top = Math.min(Math.max(0, top + dy), bottom - min);
  if (handle.includes("s")) bottom = Math.max(Math.min(1, bottom + dy), top + min);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

/** Occlusion cards sharing one stored image, in creation order. Each group is one editable note. */
export function occlusionGroups(cards: Card[]): Card[][] {
  const groups = new Map<string, Card[]>();
  for (const c of cards) {
    const img = c.kind === "occlusion" ? c.data?.image : undefined;
    if (!img) continue;
    const g = groups.get(img);
    if (g) g.push(c);
    else groups.set(img, [c]);
  }
  return [...groups.values()].map((g) => g.sort((a, b) => a.createdAt - b.createdAt));
}

/** Masks with trimmed labels; empty labels are dropped. */
export function cleanMasks(masks: OcclusionMask[]): OcclusionMask[] {
  return masks.map(({ label, ...m }) => {
    const l = label?.trim();
    return l ? { ...m, label: l } : m;
  });
}
