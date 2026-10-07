import type { Model } from "../engine/render";
import { FONT_TINY, glyph } from "./font";
import { type FontId, type Op, layout } from "./layout";

/** The LCD is a 192×75 pixel canvas (UI-SPEC §3.2): an indicator band in rows 0–6 at pixel resolution,
 * then 96×33 text dots of 2×2 pixels from row 8. */
export const PX_W = 192;
export const PX_H = 75;
const TEXT_Y = 8;
export const DOTS_W = 96;
export const DOTS_H = 33;
const X0 = 1;

class Dots {
  bits = new Uint8Array(DOTS_W * DOTS_H);
  set(x: number, y: number) {
    if (x >= 0 && x < DOTS_W && y >= 0 && y < DOTS_H) this.bits[y * DOTS_W + x] = 1;
  }
  xor(x: number, y: number, w: number, h: number) {
    for (let j = y; j < y + h; j++)
      for (let i = x; i < x + w; i++) if (i >= 0 && i < DOTS_W && j >= 0 && j < DOTS_H) this.bits[j * DOTS_W + i] ^= 1;
  }
  fill(x: number, y: number, w: number, h: number) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j);
  }
}

type Rect = [number, number, number, number];
interface Pending {
  inv: Rect[];
  blink: Rect[];
  solid: Rect[];
}

const INK_W: Record<FontId, number> = { n: 5, s: 5, m: 4 };

function drawOps(d: Dots, ops: Op[], ox: number, base: number, p: Pending) {
  for (const o of ops) {
    const x = ox + o.x;
    const y = base + o.y;
    switch (o.k) {
      case "g": {
        const g = glyph(o.key, o.font);
        const dx = Math.floor((INK_W[o.font] - g.w) / 2);
        g.rows.forEach((row, r) => {
          for (let c = 0; c < row.length; c++) if (row[c] === "#") d.set(x + dx + c, y + r);
        });
        break;
      }
      case "rect":
        d.fill(x, y, o.w, o.h);
        break;
      case "inv":
        p.inv.push([x, y, o.w, o.h]);
        break;
      case "cur":
      case "blink":
        p.blink.push([x, y, o.w, o.h]);
        break;
      case "solid":
        p.solid.push([x, y, o.w, o.h]);
        break;
    }
  }
}

const unwrap = (s: string) => ({ inv: s.startsWith("«") && s.endsWith("»"), text: s.replace(/[«»]/g, "") });

function drawGrid(d: Dots, m: Model, p: Pending) {
  const cols = m.cols ?? 3;
  const colW = Math.floor(DOTS_W / cols);
  const cellRows = m.rows.slice(0, -1);
  const edit = m.rows[m.rows.length - 1];
  const pitch = 6;
  const gridH = 4 * pitch;
  cellRows.forEach((row, r) => {
    row.l.split("|").forEach((cell, c) => {
      const { inv, text } = unwrap(cell);
      const b = layout(text, "m");
      const header = cols === 2 && r === 0;
      const x = header ? c * colW + Math.floor((colW - b.w) / 2) : c * colW + 1;
      const base = r * pitch + 5;
      drawOps(d, b.ops, x, base, p);
      if (inv) p.inv.push([c * colW, r * pitch, colW - 1, pitch]);
    });
  });
  for (let c = 1; c < cols; c++) d.fill(c * colW - 1, 0, 1, gridH);
  d.fill(0, gridH, DOTS_W, 1);
  drawOps(d, layout(edit?.l ?? "").ops, X0, DOTS_H - 1, p);
}

/** Rasterize a screen model into text-area dots. `blinkOn` shows the cursor and blinking choices. */
export function rasterize(m: Model, blinkOn: boolean): Uint8Array {
  const d = new Dots();
  const p: Pending = { inv: [], blink: [], solid: [] };
  if (m.kind === "grid") drawGrid(d, m, p);
  else if (m.kind === "menu") {
    m.rows.forEach((row, i) => {
      const b = layout(row.l, "m");
      drawOps(d, b.ops, X0, i * 6 + 5, p);
    });
  } else if (m.kind === "msg") {
    m.rows.forEach((row, i) => {
      const b = layout(row.l);
      drawOps(d, b.ops, X0 + Math.floor((DOTS_W - b.w) / 2), i * 8 + 7, p);
    });
  } else {
    let y = -(m.cut ?? 0);
    for (const row of m.rows) {
      const lb = layout(row.l || "");
      const rb = row.r !== undefined ? layout(row.r) : null;
      const asc = Math.max(lb.asc, rb?.asc ?? 0);
      const desc = Math.max(lb.desc, rb?.desc ?? 0);
      const base = y + asc;
      drawOps(d, lb.ops, X0, base, p);
      if (rb) drawOps(d, rb.ops, X0 + DOTS_W - rb.w, base, p);
      y += asc + desc;
    }
  }
  for (const r of p.inv) d.xor(...r);
  if (blinkOn) {
    for (const r of p.blink) d.xor(...r);
    for (const r of p.solid) d.fill(...r);
  }
  return d.bits;
}

/** Indicator left edges in canvas pixels (UI-SPEC §3.5). */
const IND_X: Record<string, number> = {
  L1: 0,
  "2ND": 8,
  HYP: 26,
  FIX: 39,
  K: 50,
  L2: 67,
  SCI: 76,
  ENG: 96,
  L3: 137,
  DEG: 146,
  GRAD: 154,
  RAD: 159,
  "↑": 176,
  "↓": 182,
};

/** The full 192×75 canvas: indicator band plus doubled text dots. */
export function compose(bits: Uint8Array, indicators: string[]): Uint8Array {
  const px = new Uint8Array(PX_W * PX_H);
  const set = (x: number, y: number, v = 1) => {
    if (x >= 0 && x < PX_W && y >= 0 && y < PX_H) px[y * PX_W + x] = v;
  };
  for (let y = 0; y < DOTS_H; y++)
    for (let x = 0; x < DOTS_W; x++)
      if (bits[y * DOTS_W + x]) for (let j = 0; j < 2; j++) for (let i = 0; i < 2; i++) set(x * 2 + i, TEXT_Y + y * 2 + j);
  for (const ind of indicators) {
    const x0 = IND_X[ind];
    if (x0 === undefined) continue;
    const boxed = /^L[123]$/.test(ind);
    if (boxed) for (let j = 0; j < 7; j++) for (let i = 0; i < 7; i++) set(x0 + i, j);
    let x = x0;
    for (const ch of ind) {
      const g = FONT_TINY[ch];
      if (!g) continue;
      g.rows.forEach((row, r) => {
        for (let c = 0; c < row.length; c++) if (row[c] === "#") set(x + c, (boxed ? 1 : 0) + r, boxed ? 0 : 1);
      });
      x += g.w + 1;
    }
  }
  return px;
}

export interface PaintOpts {
  /** Backing-store size in device pixels. */
  width: number;
  height: number;
  /** Device pixels per CSS px. */
  k: number;
  /** Canvas origin in CSS px. */
  origin: { x: number; y: number };
  /** White LCD rect and dot-area size in CSS px (UI-SPEC §3.1). */
  lcd: { x: number; y: number; w: number; h: number; dotsH: number };
  ink: string;
  bg: string;
}

/** Paint the LCD: the white area at its exact fractional edges, canvas pixels nearest-neighbour with separate x and y factors (UI-SPEC §3.2). */
export function paint(ctx: CanvasRenderingContext2D, px: Uint8Array, o: PaintOpts) {
  ctx.clearRect(0, 0, o.width, o.height);
  const left = (o.lcd.x - o.origin.x) * o.k;
  const top = (o.lcd.y - o.origin.y) * o.k;
  ctx.fillStyle = o.bg;
  ctx.fillRect(left, top, o.lcd.w * o.k, o.lcd.h * o.k);
  ctx.fillStyle = o.ink;
  const kx = (o.lcd.w * o.k) / PX_W;
  const ky = (o.lcd.dotsH * o.k) / PX_H;
  const ex = (i: number) => Math.round(left + i * kx);
  const ey = (i: number) => Math.round(top + i * ky);
  for (let y = 0; y < PX_H; y++) {
    let x = 0;
    while (x < PX_W) {
      if (!px[y * PX_W + x]) {
        x++;
        continue;
      }
      let e = x;
      while (e < PX_W && px[y * PX_W + e]) e++;
      ctx.fillRect(ex(x), ey(y), ex(e) - ex(x), ey(y + 1) - ey(y));
      x = e;
    }
  }
}
