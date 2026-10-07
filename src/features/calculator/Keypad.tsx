import { type PointerEvent as RPointerEvent, useId } from "react";
import { s } from "../../lib/strings";
import { ARROW_PAD, KEY_DEFS, type KeyDef, type KeyKind } from "./keys";
import { MainLegend, SecondLegend } from "./Legend";

const FACE: Record<KeyKind, { face: string; legend: string; second: string; hl: string; hlBottom: boolean }> = {
  second: { face: "var(--calc-key-2nd)", legend: "var(--calc-legend-2nd-key)", second: "", hl: "var(--calc-highlight-dark)", hlBottom: false },
  fn: { face: "var(--calc-key-fn)", legend: "var(--calc-legend-light)", second: "var(--calc-second-on-dark)", hl: "var(--calc-highlight-dark)", hlBottom: false },
  op: { face: "var(--calc-key-op)", legend: "var(--calc-legend-light)", second: "var(--calc-second-on-dark)", hl: "var(--calc-highlight-dark)", hlBottom: false },
  num: { face: "var(--calc-key-num)", legend: "var(--calc-legend-dark)", second: "var(--calc-second-on-light)", hl: "var(--calc-highlight-light)", hlBottom: true },
};

export interface KeyHandlers {
  pressed: ReadonlySet<string>;
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

function Key({ k, h }: { k: KeyDef; h: KeyHandlers }) {
  const f = FACE[k.kind];
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label={s.calc.keys[k.id] ?? k.id}
      data-key={k.id}
      data-pressed={h.pressed.has(k.id) || undefined}
      className="calc-key absolute block cursor-pointer touch-none select-none p-0 outline-none"
      style={{ left: k.x, top: k.y, width: k.w, height: k.h, background: "none", border: 0 }}
      {...handlers(k.id, h)}
    >
      <svg width={k.w} height={k.h} viewBox={`0 0 ${k.w} ${k.h}`} className="block" aria-hidden>
        <rect width={k.w} height={k.h} rx={5} style={{ fill: "var(--calc-key-border)" }} />
        <rect x={2} y={2} width={k.w - 4} height={k.h - 4} rx={3} style={{ fill: f.face }} />
        <rect x={3} y={f.hlBottom ? k.h - 3 : 2} width={k.w - 6} height={1} style={{ fill: f.hl }} />
        <g style={{ fill: f.legend, color: f.legend }}>
          <MainLegend text={k.main} w={k.w} h={k.h} />
        </g>
        {k.second && (
          <g style={{ fill: f.second, color: f.second }}>
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
const WEDGES: Record<string, string> = {
  up: `${CX},${CY} 0,0 ${P.w},0`,
  down: `${CX},${CY} 0,${P.h} ${P.w},${P.h}`,
  left: `${CX},${CY} 0,0 0,${P.h}`,
  right: `${CX},${CY} ${P.w},0 ${P.w},${P.h}`,
};
const ARROWS: Record<string, string> = {
  up: `${CX - 3.5},14 ${CX + 3.5},14 ${CX},10`,
  down: `${CX - 3.5},61 ${CX + 3.5},61 ${CX},65`,
  left: `14,${CY - 3.5} 14,${CY + 3.5} 10,${CY}`,
  right: `83,${CY - 3.5} 83,${CY + 3.5} 87,${CY}`,
};

function ArrowPad({ h }: { h: KeyHandlers }) {
  const uid = "calc" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
  const hole = { x: P.hole.x - P.x, y: P.hole.y - P.y };
  return (
    <svg className="absolute overflow-visible" style={{ left: P.x, top: P.y }} width={P.w} height={P.h} viewBox={`0 0 ${P.w} ${P.h}`}>
      <defs>
        <clipPath id={`${uid}-in`}>
          <ellipse cx={CX} cy={CY} rx={CX - 2} ry={CY - 2} />
        </clipPath>
        <clipPath id={`${uid}-out`}>
          <ellipse cx={CX} cy={CY} rx={CX} ry={CY} />
        </clipPath>
      </defs>
      <ellipse cx={CX} cy={CY} rx={CX} ry={CY} style={{ fill: "var(--calc-key-border)" }} />
      {Object.keys(WEDGES).map((id) => (
        <g
          key={id}
          data-key={id}
          role="button"
          aria-label={s.calc.keys[id]}
          data-pressed={h.pressed.has(id) || undefined}
          className="calc-key cursor-pointer touch-none"
          {...handlers(id, h)}
        >
          <g clipPath={`url(#${uid}-in)`}>
            <polygon points={WEDGES[id]} style={{ fill: "var(--calc-key-op)" }} />
            <ellipse cx={CX} cy={CY} rx={CX - 2.5} ry={CY - 2.5} fill="none" style={{ stroke: "var(--calc-highlight-pad)" }} strokeWidth={1} />
          </g>
          <polygon points={ARROWS[id]} style={{ fill: "var(--calc-legend-light)" }} />
        </g>
      ))}
      <g style={{ stroke: "var(--calc-key-border)" }} strokeWidth={2.5} pointerEvents="none" clipPath={`url(#${uid}-out)`}>
        <line x1={0} y1={0} x2={P.w} y2={P.h} />
        <line x1={P.w} y1={0} x2={0} y2={P.h} />
      </g>
      <rect
        x={hole.x}
        y={hole.y}
        width={P.hole.w}
        height={P.hole.h}
        rx={3}
        pointerEvents="none"
        style={{ fill: "var(--calc-body)", stroke: "var(--calc-key-border)" }}
        strokeWidth={2}
      />
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
