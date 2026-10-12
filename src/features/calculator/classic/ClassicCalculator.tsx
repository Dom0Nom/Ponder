import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from "lucide-react";
import { sampleCurve } from "../../../lib/plot/curves";
import { drawPlot } from "../../../lib/plot/draw";
import { fromBounds } from "../../../lib/plot/view";
import { s } from "../../../lib/strings";
import { cn } from "../../../lib/utils";
import { fitCanvas, observeSize, readLcdTheme } from "../graph/theme";
import { CLASSIC_KEYBOARD, CLASSIC_ROWS, type KeyKind } from "./keys";
import { COLS, PLOT_ASPECT, SECOND_CHARS, enabledFns, fmt, initial, press as pressKey, restore, screenText, serialize, traceReadout, type ClassicState } from "./machine";

const STORAGE_KEY = "ponder.classic.v1";

export interface ClassicHook {
  press: (key: string) => void;
  state: () => { screen: string; lines: string[]; readout: { label: string; x: number; y: number } | null };
  reset: () => void;
}

declare global {
  interface Window {
    __classic?: ClassicHook;
  }
}

function load(): ClassicState {
  try {
    return restore(localStorage.getItem(STORAGE_KEY));
  } catch {
    return initial();
  }
}

function persist(st: ClassicState) {
  try {
    localStorage.setItem(STORAGE_KEY, serialize(st));
  } catch {
    /* storage unavailable: state just won't carry over */
  }
}

const KEY_STYLE: Record<KeyKind, CSSProperties> = {
  fn: { background: "var(--calc-key-fn)", color: "var(--calc-legend-light)" },
  menu: { background: "var(--calc-key-op)", color: "var(--calc-legend-light)" },
  num: { background: "var(--calc-key-num)", color: "var(--calc-legend-dark)" },
  op: { background: "var(--calc-key-fn)", color: "var(--calc-legend-light)" },
  second: { background: "var(--calc-key-2nd)", color: "var(--calc-legend-dark)" },
  enter: { background: "var(--calc-key-fn)", color: "var(--calc-legend-light)" },
};

const ARROWS: Record<string, typeof ArrowUp> = { up: ArrowUp, down: ArrowDown, left: ArrowLeft, right: ArrowRight };

const LCD_TEXT: CSSProperties = {
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  fontSize: "7.2cqw",
  lineHeight: "8.333cqw",
  letterSpacing: "1.8cqw",
  whiteSpace: "pre",
};

function TextScreen({ state }: { state: ClassicState }) {
  const t = useMemo(() => screenText(state), [state]);
  return (
    <div className="absolute inset-0 overflow-hidden" style={{ ...LCD_TEXT, padding: "0 1cqw" }} data-testid="classic-text">
      {t.lines.map((line, r) => {
        if (!t.cursor || t.cursor.row !== r) return <div key={r}>{line || " "}</div>;
        const c = Math.min(t.cursor.col, COLS - 1);
        return (
          <div key={r}>
            {line.slice(0, c)}
            <span style={{ background: "var(--calc-lcd-ink)", color: "var(--calc-lcd)" }}>{line[c] || " "}</span>
            {line.slice(c + 1)}
          </div>
        );
      })}
    </div>
  );
}

function PlotScreen({ state }: { state: ClassicState }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => (wrap.current ? observeSize(wrap.current, (w, h) => setSize({ w, h })) : undefined), []);
  const { w, h } = size;
  const fns = useMemo(() => enabledFns(state), [state.yeq.fns, state.angle]); // eslint-disable-line react-hooks/exhaustive-deps
  const readout = traceReadout(state);
  const win = state.win;

  const sampled = useMemo(() => (w && h ? fns.map((f) => sampleCurve(f.curve, win, w, h)) : []), [fns, win, w, h]);
  const stats = useMemo(() => ({ curves: sampled.filter((x) => x.segments.length).length, samples: sampled.reduce((n, x) => n + x.points, 0) }), [sampled]);

  useLayoutEffect(() => {
    const cv = canvas.current;
    if (!cv || !w || !h) return;
    const ctx = fitCanvas(cv, w, h);
    if (!ctx) return;
    const theme = readLcdTheme(cv);
    drawPlot(ctx, {
      w,
      h,
      view: fromBounds(win, w, h),
      theme,
      grid: false,
      labels: false,
      tickMarks: true,
      xStep: win.xscl,
      yStep: win.yscl,
      curves: sampled.map((x) => ({ segments: x.segments, color: theme.axis, width: 1.5 })),
      trace: readout && Number.isFinite(readout.y) ? { x: readout.x, y: readout.y, color: theme.axis } : null,
    });
  }, [w, h, win, sampled, readout]);

  const expr = readout ? state.yeq.fns[Number(readout.label.slice(1)) - 1] : "";
  const chip: CSSProperties = { ...LCD_TEXT, fontSize: "5.6cqw", lineHeight: "7cqw", letterSpacing: "0.8cqw", background: "var(--calc-lcd)", color: "var(--calc-lcd-ink)" };

  return (
    <div ref={wrap} className="absolute inset-0" data-testid="classic-graph">
      <canvas
        ref={canvas}
        aria-label={s.classic.plotLabel}
        role="img"
        data-testid="classic-plot"
        data-curves={stats.curves}
        data-samples={stats.samples}
        className="absolute inset-0 h-full w-full"
      />
      {readout && (
        <>
          <div className="absolute left-0 top-0 px-1" style={chip}>
            {readout.label}={expr}
          </div>
          <div className="absolute inset-x-0 bottom-0 flex gap-[3cqw] px-1" style={chip} data-testid="classic-readout">
            <span>{readout.jump !== null ? `X=${readout.jump}` : `${s.classic.traceX}${fmt(readout.x)}`}</span>
            <span>{Number.isFinite(readout.y) ? `${s.classic.traceY}${fmt(readout.y)}` : s.classic.undefinedY}</span>
          </div>
        </>
      )}
      {state.message && (
        <div className="absolute inset-x-0 bottom-0 px-1" style={chip}>
          {state.message}
        </div>
      )}
    </div>
  );
}

/** Graphing calculator with a key-by-key workflow: function editor, window, zoom, graph, trace and table. */
export function ClassicCalculator({ globalKeys = false, className }: { globalKeys?: boolean; className?: string }) {
  const [state, setState] = useState<ClassicState>(load);
  const ref = useRef(state);
  ref.current = state;
  const [down, setDown] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);

  const press = useCallback((key: string) => {
    const next = pressKey(ref.current, key);
    ref.current = next;
    persist(next);
    setState(next);
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV && !("__MOCK_BACKEND__" in window)) return;
    const hook: ClassicHook = {
      press,
      state: () => {
        const r = traceReadout(ref.current);
        return { screen: ref.current.screen, lines: screenText(ref.current).lines, readout: r && { label: r.label, x: r.x, y: r.y } };
      },
      reset: () => {
        ref.current = initial();
        persist(ref.current);
        setState(ref.current);
      },
    };
    window.__classic = hook;
    return () => {
      if (window.__classic === hook) delete window.__classic;
    };
  }, [press]);

  const onKey = useCallback(
    (e: KeyboardEvent | React.KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const key = CLASSIC_KEYBOARD[e.key];
      if (!key) return;
      const t = e.target as HTMLElement | null;
      if (t?.tagName === "BUTTON" && (e.key === "Enter" || e.key === " ")) return;
      if (t?.tagName === "INPUT" || t?.tagName === "TEXTAREA") return;
      e.preventDefault();
      press(key);
    },
    [press],
  );

  useEffect(() => {
    if (!globalKeys) return;
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [globalKeys, onKey]);

  const plotScreen = state.screen === "graph" || state.screen === "trace";

  return (
    <div className={cn("flex h-full min-h-0 flex-col items-center overflow-y-auto px-3 pb-3", className)}>
      <div
        ref={root}
        role="application"
        aria-label={s.classic.title}
        data-testid="classic-calc"
        data-screen={state.screen}
        tabIndex={globalKeys ? -1 : 0}
        onKeyDown={globalKeys ? undefined : onKey}
        className="w-full max-w-[380px] shrink-0 rounded-[14px] p-3 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--calc-focus)]"
        style={{ background: "var(--calc-body)" }}
      >
        <div className="mb-1.5 flex h-4 items-center justify-between px-1 text-[10px] font-semibold tracking-wide" style={{ color: "var(--calc-legend-light)" }}>
          <span data-testid="classic-angle">{state.angle === "rad" ? s.classic.rad : s.classic.deg}</span>
          <span data-testid="classic-second" style={{ color: "var(--calc-second-on-dark)" }}>
            {state.second ? s.classic.second : ""}
          </span>
        </div>
        <div
          role="region"
          aria-label={s.classic.display}
          data-testid="classic-lcd"
          className="relative overflow-hidden rounded-[4px]"
          style={{ aspectRatio: String(PLOT_ASPECT), containerType: "inline-size", background: "var(--calc-lcd)", color: "var(--calc-lcd-ink)", border: "2px solid var(--calc-key-border)" }}
        >
          {plotScreen ? <PlotScreen state={state} /> : <TextScreen state={state} />}
        </div>

        <div role="group" aria-label={s.classic.keysGroup} className="mt-3 grid grid-cols-5 gap-x-2 gap-y-2.5">
          {CLASSIC_ROWS.flat().map((key) => {
            const alt = SECOND_CHARS[key.id]?.label;
            const Arrow = ARROWS[key.id];
            const label = s.classic.keys[key.id] ?? key.id;
            return (
              <div key={key.id} className="relative flex min-w-0 flex-col items-stretch">
                {alt && key.id !== "enter" && (
                  <span className="absolute inset-x-0 -top-3 text-center text-[9px] leading-3" style={{ color: "var(--calc-second-on-dark)" }} aria-hidden>
                    {alt}
                  </span>
                )}
                <button
                  type="button"
                  className="calc-key flex h-7 items-center justify-center rounded-[6px] text-[12px] font-semibold focus-visible:outline-2 focus-visible:outline-[color:var(--calc-focus)]"
                  style={{ ...KEY_STYLE[key.kind], border: "1px solid var(--calc-key-border)", boxShadow: state.second && key.id === "2nd" ? "0 0 0 2px var(--calc-key-ring)" : undefined }}
                  data-key={key.id}
                  data-pressed={down === key.id ? "" : undefined}
                  aria-label={s.classic.keyNames[key.id] ?? label}
                  title={s.classic.keyNames[key.id] ?? label}
                  aria-pressed={key.id === "2nd" ? state.second : undefined}
                  onPointerDown={() => setDown(key.id)}
                  onPointerUp={() => setDown(null)}
                  onPointerLeave={() => setDown(null)}
                  onClick={() => press(key.id)}
                >
                  {Arrow ? <Arrow size={14} aria-hidden /> : label}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
