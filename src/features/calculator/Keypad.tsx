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
      aria-label={s.calc.keys[k.id] ?? k.id}
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
const CX = P.w / 2;
const CY = P.h / 2;
const RX = P.w / 2;
const RY = P.h / 2;
type Pt = [number, number];

const arcPts = (a0: number, a1: number, n = 14): Pt[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return [CX + RX * Math.cos(a), CY + RY * Math.sin(a)] as Pt;
  });
const ellipseAngle = ([x, y]: Pt) => Math.atan2((y - CY) / RY, (x - CX) / RX);
const quadPts = (a: Pt, c: Pt, b: Pt, n = 8): Pt[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n;
    return [(1 - t) ** 2 * a[0] + 2 * (1 - t) * t * c[0] + t * t * b[0], (1 - t) ** 2 * a[1] + 2 * (1 - t) * t * c[1] + t * t * b[1]] as Pt;
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

const line = (a: Pt, b: Pt): Pt[] => [a, b];
const E = { tl: [19.5, 7.4] as Pt, tr: [CX * 2 - 19.5, 7.4] as Pt, bl: [19.5, P.h - 7.4] as Pt, br: [CX * 2 - 19.5, P.h - 7.4] as Pt };
const H = { tl: [40.2, 33.6] as Pt, tr: [CX * 2 - 40.2, 33.6] as Pt, bl: [40.2, P.h - 33.6] as Pt, br: [CX * 2 - 40.2, P.h - 33.6] as Pt };
const hy = 29.6;
const hx = 37.4;

const PADS: Record<string, string> = {
  up: padPath([
    arcPts(ellipseAngle(E.tl), ellipseAngle(E.tr)),
    line(E.tr, H.tr),
    quadPts(H.tr, [CX, hy], H.tl),
    line(H.tl, E.tl),
  ]),
  down: padPath([
    arcPts(-ellipseAngle(E.tl), -ellipseAngle(E.tr)),
    line(E.br, H.br),
    quadPts(H.br, [CX, P.h - hy], H.bl),
    line(H.bl, E.bl),
  ]),
  left: padPath([
    line(E.tl, H.tl),
    quadPts(H.tl, [hx, CY], H.bl),
    line(H.bl, E.bl),
    arcPts(ellipseAngle(E.bl), 2 * Math.PI + ellipseAngle(E.tl)),
  ]),
  right: padPath([
    line(E.tr, H.tr),
    quadPts(H.tr, [P.w - hx, CY], H.br),
    line(H.br, E.br),
    arcPts(ellipseAngle(E.br), ellipseAngle(E.tr)),
  ]),
};
const ARROWS: Record<string, string> = {
  up: "44.3,14.95 52.05,14.95 48.18,10.95",
  down: "44.3,61.2 51.8,61.2 48.05,64.95",
  left: "14.55,34.2 14.55,41.7 10.8,37.95",
  right: "81.8,34.2 81.8,41.7 85.55,37.95",
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
            aria-label={s.calc.keys[id]}
            data-pressed={down || undefined}
            className="calc-key cursor-pointer touch-none"
            {...handlers(id, h)}
          >
            <path d={PADS[id]} style={{ fill: down ? "var(--calc-key-pressed)" : "var(--calc-key-op)" }} />
            <g clipPath={`url(#${uid}-${id})`} fill="none">
              <path d={PADS[id]} strokeWidth={5} style={{ stroke: down ? "var(--calc-key-pressed-ring)" : "var(--calc-key-ring)" }} />
              <path d={PADS[id]} strokeWidth={3} style={{ stroke: "var(--calc-key-border)" }} />
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
