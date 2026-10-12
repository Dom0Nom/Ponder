import { forwardRef, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from "react";
import { findExtrema, findIntersections, findRoots, type Marker } from "../../../lib/plot/analyze";
import { isDrawable, sampleCurve, type Curve } from "../../../lib/plot/curves";
import { drawPlot } from "../../../lib/plot/draw";
import {
  defaultView,
  isValidView,
  pan,
  screenX,
  screenY,
  toBounds,
  wheelFactor,
  worldX,
  zoomAt,
  zoomCentered,
  type View,
} from "../../../lib/plot/view";
import { s } from "../../../lib/strings";
import { cn } from "../../../lib/utils";
import { fitCanvas, observeSize, plotColor, readPlotTheme } from "./theme";

export interface PlotItem {
  id: string;
  curve: Curve;
  color: number;
  visible: boolean;
}

export interface PlotHandle {
  zoom: (factor: number) => void;
  reset: () => void;
}

interface Props {
  items: PlotItem[];
  view: View | null;
  onViewChange: (v: View | null) => void;
  markers: boolean;
  label: string;
  emptyText: string;
  className?: string;
}

interface Hit {
  x: number;
  y: number;
  color: number;
  kind?: Marker["kind"];
}

const KEY_PAN = 60;

const num = (v: number) => (Math.abs(v) < 1e-12 ? "0" : String(Number(v.toPrecision(4))));

export const PlotCanvas = forwardRef<PlotHandle, Props>(function PlotCanvas({ items, view, onViewChange, markers, label, emptyText, className }, ref) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<{ px: number; py: number } | null>(null);
  const [themeTick, setThemeTick] = useState(0);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const dragged = useRef(false);

  useLayoutEffect(() => (wrap.current ? observeSize(wrap.current, (w, h) => setSize({ w, h })) : undefined), []);
  useEffect(() => {
    const mo = new MutationObserver(() => setThemeTick((t) => t + 1));
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme", "data-font"] });
    return () => mo.disconnect();
  }, []);

  const { w, h } = size;
  const eff = useMemo(() => (view && isValidView(view) ? view : defaultView(w || 400)), [view, w]);
  const effRef = useRef(eff);
  effRef.current = eff;
  const sizeRef = useRef(size);
  sizeRef.current = size;

  const sampled = useMemo(() => {
    if (!w || !h) return [];
    const b = toBounds(eff, w, h);
    return items.map((it) => (it.visible ? sampleCurve(it.curve, b, w, h) : { segments: [], points: 0 }));
  }, [items, eff, w, h]);

  const found = useMemo<Marker[]>(() => {
    if (!markers || !w || !h) return [];
    const b = toBounds(eff, w, h);
    const out: Marker[] = [];
    const ys = items.map((it, i) => ({ it, i })).filter(({ it }) => it.visible && it.curve.kind === "y");
    for (const { it, i } of ys) {
      if (it.curve.kind !== "y") continue;
      const f = it.curve.f;
      for (const x of findRoots(f, b.xmin, b.xmax)) out.push({ kind: "root", x, y: 0, curve: i });
      for (const e of findExtrema(f, b.xmin, b.xmax)) out.push({ kind: e.kind, x: e.x, y: e.y, curve: i });
    }
    for (let a = 0; a < ys.length; a++) {
      for (let c = a + 1; c < ys.length; c++) {
        const fa = ys[a].it.curve;
        const fc = ys[c].it.curve;
        if (fa.kind !== "y" || fc.kind !== "y") continue;
        for (const p of findIntersections(fa.f, fc.f, b.xmin, b.xmax)) out.push({ kind: "intersection", x: p.x, y: p.y, curve: ys[a].i });
      }
    }
    return out;
  }, [markers, items, eff, w, h]);

  const hit = useMemo<Hit | null>(() => {
    if (!hover || !w || !h) return null;
    let best: (Hit & { d: number }) | null = null;
    for (const m of found) {
      const d = Math.hypot(screenX(eff, w, m.x) - hover.px, screenY(eff, h, m.y) - hover.py);
      if (d <= 12 && (!best || d < best.d)) best = { x: m.x, y: m.y, color: items[m.curve].color, kind: m.kind, d };
    }
    if (best) return best;
    const wx = worldX(eff, w, hover.px);
    items.forEach((it, i) => {
      if (!it.visible || it.curve.kind !== "y") return;
      const y = it.curve.f(wx);
      if (!Number.isFinite(y)) return;
      const d = Math.abs(screenY(eff, h, y) - hover.py);
      if (d <= 40 && (!best || d < best.d)) best = { x: wx, y, color: it.color, d };
    });
    return best;
  }, [hover, found, items, eff, w, h]);

  const stats = useMemo(() => {
    let curves = 0;
    let samples = 0;
    let segments = 0;
    for (const s of sampled) {
      if (s.segments.length) curves++;
      samples += s.points;
      segments += s.segments.length;
    }
    return { curves, samples, segments };
  }, [sampled]);

  useLayoutEffect(() => {
    const cv = canvas.current;
    if (!cv || !w || !h) return;
    const ctx = fitCanvas(cv, w, h);
    if (!ctx) return;
    drawPlot(ctx, {
      w,
      h,
      view: eff,
      theme: readPlotTheme(cv),
      curves: items.map((it, i) => ({ segments: sampled[i]?.segments ?? [], color: plotColor(cv, it.color), width: 2 })),
      markers: found.map((m) => ({ marker: m, color: plotColor(cv, items[m.curve].color) })),
      trace: hit ? { x: hit.x, y: hit.y, color: plotColor(cv, hit.color) } : null,
    });
  }, [w, h, eff, items, sampled, found, hit, themeTick]);

  const set = useCallback((v: View | null) => onViewChange(v), [onViewChange]);

  const zoom = useCallback(
    (factor: number) => set(zoomCentered(effRef.current, factor)),
    [set],
  );
  useImperativeHandle(ref, () => ({ zoom, reset: () => set(null) }), [zoom, set]);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const { w: cw, h: ch } = sizeRef.current;
      set(zoomAt(effRef.current, wheelFactor(e.deltaY), e.clientX - r.left, e.clientY - r.top, cw, ch));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [set]);

  const local = (e: React.PointerEvent) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, local(e));
    dragged.current = false;
    if (e.pointerType !== "mouse") setHover(null);
  };
  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const p = local(e);
    const prev = pointers.current.get(e.pointerId);
    if (!prev) {
      if (e.pointerType === "mouse") setHover({ px: p.x, py: p.y });
      return;
    }
    const { w: cw, h: ch } = sizeRef.current;
    const others = [...pointers.current.entries()].filter(([id]) => id !== e.pointerId).map(([, v]) => v);
    pointers.current.set(e.pointerId, p);
    dragged.current = true;
    if (others.length === 1) {
      const o = others[0];
      const d0 = Math.hypot(prev.x - o.x, prev.y - o.y);
      const d1 = Math.hypot(p.x - o.x, p.y - o.y);
      if (d0 > 0 && d1 > 0) set(zoomAt(effRef.current, d1 / d0, (p.x + o.x) / 2, (p.y + o.y) / 2, cw, ch));
      return;
    }
    set(pan(effRef.current, p.x - prev.x, p.y - prev.y));
    setHover(null);
  };
  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    pointers.current.delete(e.pointerId);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const step = e.shiftKey ? KEY_PAN * 4 : KEY_PAN;
    const v = effRef.current;
    const { w: cw, h: ch } = sizeRef.current;
    const handled = (() => {
      switch (e.key) {
        case "ArrowLeft":
          set(pan(v, step, 0));
          return true;
        case "ArrowRight":
          set(pan(v, -step, 0));
          return true;
        case "ArrowUp":
          set(pan(v, 0, step));
          return true;
        case "ArrowDown":
          set(pan(v, 0, -step));
          return true;
        case "+":
        case "=":
          set(zoomAt(v, 1.5, cw / 2, ch / 2, cw, ch));
          return true;
        case "-":
        case "_":
          set(zoomAt(v, 1 / 1.5, cw / 2, ch / 2, cw, ch));
          return true;
        case "0":
          set(null);
          return true;
      }
      return false;
    })();
    if (handled) e.preventDefault();
  };

  const drawable = items.some((it) => it.visible && isDrawable(it.curve));
  const b = w && h ? toBounds(eff, w, h) : null;
  const tip = hit && w ? { left: Math.min(Math.max(screenX(eff, w, hit.x) + 10, 4), Math.max(4, w - 130)), top: Math.max(screenY(eff, h, hit.y) - 34, 4) } : null;

  return (
    <div ref={wrap} className={cn("relative overflow-hidden rounded-card border border-border bg-surface", className)}>
      <canvas
        ref={canvas}
        role="application"
        aria-label={label}
        tabIndex={0}
        data-testid="graph-plot"
        data-curves={stats.curves}
        data-samples={stats.samples}
        data-segments={stats.segments}
        data-markers={found.length}
        data-xmin={b ? Number(b.xmin.toPrecision(6)) : undefined}
        data-xmax={b ? Number(b.xmax.toPrecision(6)) : undefined}
        data-ymin={b ? Number(b.ymin.toPrecision(6)) : undefined}
        data-ymax={b ? Number(b.ymax.toPrecision(6)) : undefined}
        className="absolute inset-0 h-full w-full cursor-grab touch-none outline-none focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing"
        style={{ width: "100%", height: "100%" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKeyDown}
      />
      {tip && hit && (
        <div
          data-testid="graph-trace"
          className="pointer-events-none absolute rounded-btn border border-border bg-surface px-1.5 py-0.5 text-meta text-fg shadow-float"
          style={{ left: tip.left, top: tip.top }}
        >
          {hit.kind && <span className="mr-1 text-muted">{s.graph.markerNames[hit.kind]}</span>}({num(hit.x)}, {num(hit.y)})
        </div>
      )}
      {!drawable && (
        <div className="pointer-events-none absolute inset-x-0 top-3 text-center text-meta text-muted" data-testid="graph-empty">
          {emptyText}
        </div>
      )}
    </div>
  );
});
