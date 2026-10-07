import type { Model } from "../engine/render";
import { FONT, FONT_SMALL } from "./font";
import { type Op, layout } from "./layout";

/** 96×41 dot LCD: a 7-row indicator band, then 34 text rows (UI-SPEC §3). */
export const COLS = 96;
export const ROWS = 41;
export const BAND = 7;

class Bitmap {
  bits = new Uint8Array(COLS * ROWS);
  set(x: number, y: number, v = 1) {
    if (x >= 0 && x < COLS && y >= 0 && y < ROWS) this.bits[y * COLS + x] = v;
  }
  xor(x: number, y: number, w: number, h: number) {
    for (let j = y; j < y + h; j++)
      for (let i = x; i < x + w; i++) if (i >= 0 && i < COLS && j >= 0 && j < ROWS) this.bits[j * COLS + i] ^= 1;
  }
  fill(x: number, y: number, w: number, h: number) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j);
  }
}

interface Pending {
  inv: [number, number, number, number][];
  blink: [number, number, number, number][];
}

function drawOps(bm: Bitmap, ops: Op[], ox: number, base: number, p: Pending) {
  for (const o of ops) {
    const x = ox + o.x;
    const y = base + o.y;
    switch (o.k) {
      case "g": {
        const g = o.small ? FONT_SMALL[o.key] : (FONT[o.key] ?? FONT["?"]);
        g.rows.forEach((row, r) => {
          for (let c = 0; c < row.length; c++) if (row[c] === "#") bm.set(x + c, y + r);
        });
        break;
      }
      case "rect":
        bm.fill(x, y, o.w, o.h);
        break;
      case "inv":
        p.inv.push([x, y, o.w, o.h]);
        break;
      case "cur":
      case "blink":
        p.blink.push([x, y, o.w, o.h]);
        break;
    }
  }
}

const stripInv = (s: string) => ({ inv: s.startsWith("«") && s.endsWith("»"), text: s.replace(/[«»]/g, "") });

function drawGrid(bm: Bitmap, m: Model, p: Pending) {
  const cols = m.cols ?? 3;
  const colW = Math.floor(COLS / cols);
  const cellRows = m.rows.slice(0, -1);
  const edit = m.rows[m.rows.length - 1];
  const pitch = 6;
  const top = BAND + 1;
  const gridH = 4 * pitch + 1;
  cellRows.forEach((row, r) => {
    row.l.split("|").forEach((cell, c) => {
      const { inv, text } = stripInv(cell);
      const b = layout(text, true);
      const x0 = c * colW + 1;
      const base = top + r * pitch + 5;
      const header = cols === 2 && r === 0;
      const x = header ? c * colW + Math.floor((colW - b.w) / 2) : x0;
      drawOps(bm, b.ops, x, base, p);
      if (inv) p.inv.push([c * colW, base - 6, colW - 1, pitch + 1]);
    });
  });
  for (let c = 1; c < cols; c++) bm.fill(c * colW - 1, top - 1, 1, gridH);
  bm.fill(0, top - 1 + gridH, COLS, 1);
  const eb = layout(edit.l);
  drawOps(bm, eb.ops, 0, ROWS - 1, p);
}

/** Rasterize a screen model into dots. `blinkOn` shows the cursor/blinking choice. */
export function rasterize(m: Model, blinkOn: boolean): Uint8Array {
  const bm = new Bitmap();
  const p: Pending = { inv: [], blink: [] };
  if (m.kind === "grid") drawGrid(bm, m, p);
  else if (m.kind === "msg") {
    const b = layout(m.rows[0]?.l ?? "");
    drawOps(bm, b.ops, Math.max(0, Math.floor((COLS - b.w + 1) / 2)), BAND + 12, p);
  } else {
    let y = BAND;
    for (const row of m.rows) {
      const lb = layout(row.l || "");
      const rb = row.r !== undefined ? layout(row.r) : null;
      const asc = Math.max(lb.asc, rb?.asc ?? 0);
      const desc = Math.max(lb.desc, rb?.desc ?? 0);
      const base = y + asc;
      drawOps(bm, lb.ops, 0, base, p);
      if (rb) drawOps(bm, rb.ops, COLS - rb.w + 1, base, p);
      y += asc + desc;
    }
  }
  for (const r of p.inv) bm.xor(...r);
  if (blinkOn) for (const r of p.blink) bm.xor(...r);
  return bm.bits;
}

/** Indicator anchors as a fraction of the LCD width (UI-SPEC §3.4). */
const IND_X: Record<string, number> = {
  "2ND": 0.02,
  HYP: 0.12,
  FIX: 0.24,
  K: 0.32,
  SCI: 0.4,
  ENG: 0.4,
  DEG: 0.8,
  RAD: 0.83,
  GRAD: 0.8,
  "↑": 0.93,
  "↓": 0.96,
  L1: 0.02,
  L2: 0.35,
  L3: 0.68,
};

export interface PaintOpts {
  /** Canvas size in device pixels. */
  width: number;
  height: number;
  ink: string;
  bg: string;
  font: string;
}

export function paint(ctx: CanvasRenderingContext2D, bits: Uint8Array, indicators: string[], o: PaintOpts) {
  ctx.fillStyle = o.bg;
  ctx.fillRect(0, 0, o.width, o.height);
  let pitch = o.width / COLS;
  if (pitch >= 3) pitch = Math.floor(pitch);
  const ox = Math.round((o.width - pitch * COLS) / 2);
  const oy = Math.round((o.height - pitch * ROWS) / 2);
  const dot = pitch >= 6 ? pitch - 1 : null;
  ctx.fillStyle = o.ink;
  // below 6 px per dot the dots touch; snap edges to whole pixels so neighbours leave no seams
  const edge = (i: number, o0: number) => Math.round(o0 + i * pitch);
  for (let y = BAND; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) {
      if (!bits[y * COLS + x]) continue;
      if (dot) ctx.fillRect(ox + x * pitch, oy + y * pitch, dot, dot);
      else ctx.fillRect(edge(x, ox), edge(y, oy), edge(x + 1, ox) - edge(x, ox), edge(y + 1, oy) - edge(y, oy));
    }
  const px = o.width / 243;
  ctx.font = `700 ${Math.max(5, 5.5 * px)}px ${o.font}`;
  ctx.textBaseline = "top";
  for (const ind of indicators) {
    const fx = IND_X[ind] ?? 0.5;
    const x = fx * o.width;
    const y = 1.5 * px;
    ctx.fillText(ind, x, y);
    if (/^L[123]$/.test(ind)) {
      const w = ctx.measureText(ind).width;
      ctx.strokeStyle = o.ink;
      ctx.lineWidth = Math.max(1, 0.6 * px);
      ctx.strokeRect(x - px, y - px, w + 2 * px, 7 * px);
    }
  }
}
