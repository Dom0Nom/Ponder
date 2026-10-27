import { type PointerEvent as RPointerEvent, useId } from "react";
import { s } from "../../lib/strings";
import { ARROW_PAD, KEY_DEFS, PITCH, type KeyDef, type KeyKind } from "./keys";
import { MainLegend, SecondLegend } from "./Legend";

const FACE: Record<KeyKind, { face: string; legend: string; second: string; ring: boolean }> = {
  second: { face: "var(--calc-key-2nd)", legend: "var(--calc-legend-2nd-key)", second: "", ring: false },
  fn: { face: "var(--calc-key-fn)", legend: "var(--calc-legend-light)", second: "var(--calc-second-on-dark)", ring: true },
  op: { face: "var(--calc-key-op)", legend: "var(--calc-legend-light)", second: "var(--calc-second-on-dark)", ring: true },
  num: { face: "var(--calc-key-num)", legend: "var(--calc-legend-dark)", second: "var(--calc-second-on-light)", ring: false },
};

export interface KeyHandlers {
  pressed: ReadonlySet<string>;
  last: string | null;
  onDown: (id: string) => void;
  onUp: (id: string) => void;
}

function handlers(id: string, h: KeyHandlers) {
  return {
    onPointerDown: (e: RPointerEvent) => {
      if (e.button !== 0) return;
      e.preventDefault();
      (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
      h.onDown(id);
    },
    onPointerUp: () => h.onUp(id),
    onPointerCancel: () => h.onUp(id),
    onLostPointerCapture: () => h.onUp(id),
  };
}

const R = 5.5;

function Key({ k, h }: { k: KeyDef; h: KeyHandlers }) {
  const f = FACE[k.kind];
  const down = h.pressed.has(k.id);
  const legend = down ? "var(--calc-legend-light)" : f.legend;
  const second = down ? "var(--calc-legend-light)" : f.second;
  const padX = (PITCH.x - k.w) / 2;
  const padY = (PITCH.y - k.h) / 2;
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={s.calc.keys[k.id === "." ? "dot" : k.id] ?? k.id}
      data-key={k.id}
      data-pressed={down || undefined}
      data-last={h.last === k.id || undefined}
      className="calc-key absolute block cursor-pointer touch-none select-none p-0 outline-none"
      style={{ left: k.x - padX, top: k.y - padY, width: PITCH.x, height: PITCH.y, background: "none", border: 0 }}
      {...handlers(k.id, h)}
    >
      <svg width={k.w} height={k.h} viewBox={`0 0 ${k.w} ${k.h}`} className="absolute block" style={{ left: padX, top: padY }} aria-hidden>
        <rect width={k.w} height={k.h} rx={R} style={{ fill: "var(--calc-key-border)" }} />
        <rect className="calc-focus" width={k.w} height={k.h} rx={R} style={{ fill: "var(--calc-focus)" }} />
        {f.ring && (
          <rect x={2} y={2} width={k.w - 4} height={k.h - 4} rx={R - 2} style={{ fill: down ? "var(--calc-key-pressed-ring)" : "var(--calc-key-ring)" }} />
        )}
        <rect
          x={f.ring ? 3 : 2}
          y={f.ring ? 3 : 2}
          width={k.w - (f.ring ? 6 : 4)}
          height={k.h - (f.ring ? 6 : 4)}
          rx={R - (f.ring ? 3 : 2)}
          style={{ fill: down ? "var(--calc-key-pressed)" : f.face }}
        />
        <g style={{ fill: legend, color: legend }}>
          <MainLegend text={k.main} w={k.w} h={k.h} />
        </g>
        {k.second && (
          <g style={{ fill: second, color: second }}>
            <SecondLegend text={k.second} w={k.w} />
          </g>
        )}
      </svg>
    </button>
  );
}

const P = ARROW_PAD;
type Pt = [number, number];

const ECX = 275.375;
const ECY = 222.5;
const ERX = 46.6;
const ERY = 36.25;
const loc = ([x, y]: Pt): Pt => [x - P.x, y - P.y];
const onEllipseX = (x: number, top: boolean): Pt => [x, ECY + (top ? -1 : 1) * ERY * Math.sqrt(1 - ((x - ECX) / ERX) ** 2)];
const onEllipseY = (y: number, left: boolean): Pt => [ECX + (left ? -1 : 1) * ERX * Math.sqrt(1 - ((y - ECY) / ERY) ** 2), y];
const ang = ([x, y]: Pt) => Math.atan2((y - ECY) / ERY, (x - ECX) / ERX);
const arcPts = (a: Pt, b: Pt, wrap = false, n = 16): Pt[] => {
  const a0 = ang(a);
  let a1 = ang(b);
  if (wrap && a1 < a0) a1 += 2 * Math.PI;
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = a0 + ((a1 - a0) * i) / n;
    return loc([ECX + ERX * Math.cos(t), ECY + ERY * Math.sin(t)]);
  });
};
const quadPts = (a: Pt, c: Pt, b: Pt, n = 8): Pt[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    return loc([(1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0], (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1]]);
  });

/** Closed path through the corner points, edges given as sampled polylines, corners rounded. */
function padPath(edges: Pt[][], r = 3): string {
  const n = edges.length;
  const dir = (from: Pt, to: Pt): Pt => {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const l = Math.hypot(dx, dy) || 1;
    return [dx / l, dy / l];
  };
  let d = "";
  for (let i = 0; i < n; i++) {
    const prev = edges[(i + n - 1) % n];
    const next = edges[i];
    const v = next[0];
    const pd = dir(v, prev[prev.length - 2]);
    const nd = dir(v, next[1]);
    const cmd = (c: string, p: Pt) => `${c}${p[0].toFixed(2)},${p[1].toFixed(2)}`;
    d += cmd(i ? "L" : "M", [v[0] + pd[0] * r, v[1] + pd[1] * r]) + "Q" + `${v[0].toFixed(2)},${v[1].toFixed(2)} ${(v[0] + nd[0] * r).toFixed(2)},${(v[1] + nd[1] * r).toFixed(2)}`;
    for (let j = 2; j < next.length - 1; j++) d += cmd("L", next[j]);
  }
  return d + "Z";
}

const line = (a: Pt, b: Pt): Pt[] => [loc(a), loc(b)];

// Pad outlines are the outer edge of the 1 px ring; the black outline is drawn outside it.
const UW = 28.3;
const UT = onEllipseX(ECX - UW, true);
const UTR = onEllipseX(ECX + UW, true);
const DB = onEllipseX(ECX - UW, false);
const DBR = onEllipseX(ECX + UW, false);
const LT = onEllipseY(195.8, true);
const LB = onEllipseY(249.2, true);
const RT = onEllipseY(195.8, false);
const RB = onEllipseY(249.2, false);
const HUX = 267.6;
const HUY = 215.9;
const HLX = 266.75;
const HLY = 218.4;
const hu = (l: boolean, top: boolean): Pt => [l ? HUX : 2 * ECX - HUX, top ? HUY : 2 * ECY - HUY];
const hl = (l: boolean, top: boolean): Pt => [l ? HLX : 2 * ECX - HLX, top ? HLY : 2 * ECY - HLY];

const PADS: Record<string, string> = {
  up: padPath([
    arcPts(UT, UTR),
    line(UTR, hu(false, true)),
    quadPts(hu(false, true), [ECX, 214.1], hu(true, true)),
    line(hu(true, true), UT),
  ]),
  down: padPath([
    arcPts(DB, DBR),
    line(DBR, hu(false, false)),
    quadPts(hu(false, false), [ECX, 2 * ECY - 214.1], hu(true, false)),
    line(hu(true, false), DB),
  ]),
  left: padPath([
    line(LT, hl(true, true)),
    quadPts(hl(true, true), [264.4, ECY], hl(true, false)),
    line(hl(true, false), LB),
    arcPts(LB, LT, true),
  ]),
  right: padPath([
    line(RT, hl(false, true)),
    quadPts(hl(false, true), [2 * ECX - 264.4, ECY], hl(false, false)),
    line(hl(false, false), RB),
    arcPts(RB, RT),
  ]),
};
const poly = (pts: Pt[]) => pts.map((p) => loc(p).map((v) => v.toFixed(2)).join(",")).join(" ");
const ARROWS: Record<string, string> = {
  up: poly([[271.25, 199.5], [279.25, 199.5], [275.25, 195.5]]),
  down: poly([[271.5, 245.75], [279.25, 245.75], [275.375, 249.5]]),
  left: poly([[241.75, 218.75], [241.75, 226.25], [238, 222.5]]),
  right: poly([[309, 218.75], [309, 226.25], [312.75, 222.5]]),
};

function ArrowPad({ h }: { h: KeyHandlers }) {
  const uid = "calc" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const ids = Object.keys(PADS);
  return (
    <svg className="absolute overflow-visible" style={{ left: P.x, top: P.y }} width={P.w} height={P.h} viewBox={`0 0 ${P.w} ${P.h}`}>
      <defs>
        {ids.map((id) => (
          <clipPath key={id} id={`${uid}-${id}`}>
            <path d={PADS[id]} />
          </clipPath>
        ))}
      </defs>
      <g pointerEvents="none" fill="none" strokeLinejoin="round" style={{ stroke: "var(--calc-key-border)" }} strokeWidth={3}>
        {ids.map((id) => (
          <path key={id} d={PADS[id]} />
        ))}
      </g>
      {ids.map((id) => {
        const down = h.pressed.has(id);
        return (
          <g
            key={id}
            data-key={id}
            role="button"
            aria-label={s.calc.keys[id === "." ? "dot" : id]}
            data-pressed={down || undefined}
            className="calc-key cursor-pointer touch-none"
            {...handlers(id, h)}
          >
            <path d={PADS[id]} style={{ fill: down ? "var(--calc-key-pressed)" : "var(--calc-key-op)" }} />
            <g clipPath={`url(#${uid}-${id})`} fill="none">
              <path d={PADS[id]} strokeWidth={2} style={{ stroke: down ? "var(--calc-key-pressed-ring)" : "var(--calc-key-ring)" }} />
            </g>
            <polygon points={ARROWS[id]} style={{ fill: "var(--calc-legend-light)" }} />
          </g>
        );
      })}
    </svg>
  );
}

export function Keypad({ h }: { h: KeyHandlers }) {
  return (
    <>
      {KEY_DEFS.map((k) => (
        <Key key={k.id} k={k} h={h} />
      ))}
      <ArrowPad h={h} />
    </>
  );
}
