import { type PointerEvent as RPointerEvent, useId } from "react";
import { s } from "../../lib/strings";
import { ARROW_PAD, KEY_DEFS, PITCH, type KeyDef, type KeyKind } from "./keys";
import { MainLegend, SecondLegend } from "./Legend";

const FACE: Record<KeyKind, { face: string; legend: string; second: string; ring: string; ringBottom: boolean }> = {
  second: { face: "var(--calc-key-2nd)", legend: "var(--calc-legend-2nd-key)", second: "", ring: "var(--calc-key-ring)", ringBottom: false },
  fn: { face: "var(--calc-key-fn)", legend: "var(--calc-legend-light)", second: "var(--calc-second-on-dark)", ring: "var(--calc-key-ring)", ringBottom: false },
  op: { face: "var(--calc-key-op)", legend: "var(--calc-legend-light)", second: "var(--calc-second-on-dark)", ring: "var(--calc-key-ring)", ringBottom: false },
  num: { face: "var(--calc-key-num)", legend: "var(--calc-legend-dark)", second: "var(--calc-second-on-light)", ring: "var(--calc-key-ring-light)", ringBottom: true },
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
        {down ? (
          <rect x={2} y={2} width={k.w - 4} height={k.h - 4} rx={R - 2} style={{ fill: "var(--calc-key-pressed-ring)" }} />
        ) : f.ringBottom ? (
          <rect x={3} y={k.h - 3} width={k.w - 6} height={1} style={{ fill: f.ring }} />
        ) : (
          <rect x={2} y={2} width={k.w - 4} height={k.h - 4} rx={R - 2} style={{ fill: f.ring }} />
        )}
        <rect
          x={3}
          y={down || !f.ringBottom ? 3 : 2}
          width={k.w - 6}
          height={k.h - (down || !f.ringBottom ? 6 : 5)}
          rx={R - 3}
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
const WEDGES: Record<string, string> = {
  up: `${CX},${CY} 0,0 ${P.w},0`,
  down: `${CX},${CY} 0,${P.h} ${P.w},${P.h}`,
  left: `${CX},${CY} 0,0 0,${P.h}`,
  right: `${CX},${CY} ${P.w},0 ${P.w},${P.h}`,
};
const ARROWS: Record<string, string> = {
  up: `${CX - 3.5},14 ${CX + 3.5},14 ${CX},10`,
  down: `${CX - 3.5},${P.h - 14} ${CX + 3.5},${P.h - 14} ${CX},${P.h - 10}`,
  left: `14,${CY - 3.5} 14,${CY + 3.5} 10,${CY}`,
  right: `${P.w - 14},${CY - 3.5} ${P.w - 14},${CY + 3.5} ${P.w - 10},${CY}`,
};

function ArrowPad({ h }: { h: KeyHandlers }) {
  const uid = "calc" + useId().replace(/[^a-zA-Z0-9_-]/g, "");
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
      {Object.keys(WEDGES).map((id) => {
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
            <g clipPath={`url(#${uid}-in)`}>
              <polygon points={WEDGES[id]} style={{ fill: down ? "var(--calc-key-pressed)" : "var(--calc-key-op)" }} />
              <ellipse
                cx={CX}
                cy={CY}
                rx={CX - 2.5}
                ry={CY - 2.5}
                fill="none"
                style={{ stroke: down ? "var(--calc-key-pressed-ring)" : "var(--calc-key-ring)" }}
                strokeWidth={1}
              />
            </g>
            <polygon points={ARROWS[id]} style={{ fill: "var(--calc-legend-light)" }} />
          </g>
        );
      })}
      <g style={{ stroke: "var(--calc-key-border)" }} strokeWidth={2.5} pointerEvents="none" clipPath={`url(#${uid}-out)`}>
        <line x1={0} y1={0} x2={P.w} y2={P.h} />
        <line x1={P.w} y1={0} x2={0} y2={P.h} />
      </g>
      <rect
        x={CX - P.hole.w / 2}
        y={CY - P.hole.h / 2}
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
