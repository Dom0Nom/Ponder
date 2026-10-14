import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Eye, EyeOff, Minus, Plus, RotateCcw, Sigma, X } from "lucide-react";
import { buildCurve } from "../../../lib/plot/curves";
import type { AngleMode, ParseError } from "../../../lib/plot/parser";
import { isValidView, type View } from "../../../lib/plot/view";
import { s } from "../../../lib/strings";
import { cn } from "../../../lib/utils";
import { Button } from "../../../components/ui/button";
import { Segmented, Tooltip } from "../../../components/ui/misc";
import { PlotCanvas, type PlotHandle, type PlotItem } from "./PlotCanvas";
import { PLOT_COLORS } from "./theme";

const STORAGE_KEY = "ponder.graph.v1";
const MAX_ITEMS = 12;

interface Item {
  id: string;
  src: string;
  color: number;
  visible: boolean;
}

interface Saved {
  items: Item[];
  angle: AngleMode;
  view: View | null;
  markers: boolean;
}

let nextId = 1;
const newItem = (color: number, src = ""): Item => ({ id: `e${nextId++}`, src, color: color % PLOT_COLORS, visible: true });

function load(): Saved {
  const fresh: Saved = { items: [newItem(0)], angle: "rad", view: null, markers: false };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return fresh;
    const p = JSON.parse(raw) as Partial<Saved>;
    const items = Array.isArray(p.items)
      ? p.items.slice(0, MAX_ITEMS).map((it, i) => ({ ...newItem(typeof it.color === "number" ? it.color : i, String(it.src ?? "")), visible: it.visible !== false }))
      : [];
    return {
      items: items.length ? items : fresh.items,
      angle: p.angle === "deg" ? "deg" : "rad",
      view: p.view && isValidView(p.view) ? p.view : null,
      markers: p.markers === true,
    };
  } catch {
    return fresh;
  }
}

function save(v: Saved) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
  } catch {
    /* storage unavailable: the graph still works for this session */
  }
}

export function errorMessage(e: ParseError): string {
  const errors = s.graph.errors;
  if (e.code === "unexpected") return e.detail ? errors.unexpected(e.detail) : errors.unexpectedChar;
  if (e.code === "unknownName") return errors.unknownName(e.detail ?? "");
  return errors[e.code];
}

export function GraphingCalculator({ className }: { className?: string }) {
  const [state, setState] = useState<Saved>(load);
  const plot = useRef<PlotHandle>(null);
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const focusNew = useRef<string | null>(null);
  const { items, angle, view, markers } = state;

  useEffect(() => save(state), [state]);
  useEffect(() => {
    if (focusNew.current) {
      inputs.current.get(focusNew.current)?.focus();
      focusNew.current = null;
    }
  });

  const patch = useCallback((p: Partial<Saved>) => setState((st) => ({ ...st, ...p })), []);
  const setItem = (id: string, p: Partial<Item>) => setState((st) => ({ ...st, items: st.items.map((it) => (it.id === id ? { ...it, ...p } : it)) }));
  const add = () => {
    setState((st) => {
      if (st.items.length >= MAX_ITEMS) return st;
      const used = new Set(st.items.map((i) => i.color));
      const color = [...Array(PLOT_COLORS).keys()].find((c) => !used.has(c)) ?? st.items.length;
      const it = newItem(color);
      focusNew.current = it.id;
      return { ...st, items: [...st.items, it] };
    });
  };
  const remove = (id: string) => setState((st) => ({ ...st, items: st.items.length > 1 ? st.items.filter((it) => it.id !== id) : st.items.map((it) => ({ ...it, src: "" })) }));

  const curves = useMemo(() => items.map((it) => buildCurve(it.src, angle)), [items, angle]);
  const plotItems = useMemo<PlotItem[]>(() => items.map((it, i) => ({ id: it.id, curve: curves[i], color: it.color, visible: it.visible })), [items, curves]);

  return (
    <div data-testid="graph-calc" className={cn("flex h-full min-h-0 flex-col gap-2 px-3 pb-3", className)}>
      <div className="flex shrink-0 items-center gap-1" role="toolbar" aria-label={s.graph.title}>
        <Tooltip content={s.graph.zoomIn}>
          <Button variant="chrome" size="icon-sm" aria-label={s.graph.zoomIn} onClick={() => plot.current?.zoom(1.5)}>
            <Plus size={15} />
          </Button>
        </Tooltip>
        <Tooltip content={s.graph.zoomOut}>
          <Button variant="chrome" size="icon-sm" aria-label={s.graph.zoomOut} onClick={() => plot.current?.zoom(1 / 1.5)}>
            <Minus size={15} />
          </Button>
        </Tooltip>
        <Tooltip content={s.graph.reset}>
          <Button variant="chrome" size="icon-sm" aria-label={s.graph.reset} onClick={() => plot.current?.reset()}>
            <RotateCcw size={14} />
          </Button>
        </Tooltip>
        <Tooltip content={s.graph.markers}>
          <Button variant="chrome" size="icon-sm" aria-label={s.graph.markers} aria-pressed={markers} onClick={() => patch({ markers: !markers })}>
            <Sigma size={15} />
          </Button>
        </Tooltip>
        <div className="ml-auto">
          <Segmented<AngleMode>
            size="sm"
            label={s.graph.angle}
            value={angle}
            onChange={(a) => patch({ angle: a })}
            options={[
              { value: "rad", label: s.graph.radShort, title: s.graph.rad },
              { value: "deg", label: s.graph.degShort, title: s.graph.deg },
            ]}
          />
        </div>
      </div>

      <PlotCanvas
        ref={plot}
        items={plotItems}
        view={view}
        onViewChange={(v) => patch({ view: v })}
        markers={markers}
        label={s.graph.plotLabel}
        emptyText={s.graph.empty}
        className="min-h-[180px] flex-[3]"
      />

      <ul className="min-h-[96px] flex-[2] space-y-1.5 overflow-y-auto" aria-label={s.graph.expressions}>
        {items.map((it, i) => {
          const c = curves[i];
          const err = c.kind === "error" ? errorMessage(c.error) : null;
          const errId = `${it.id}-err`;
          return (
            <li key={it.id}>
              <div className="flex items-center gap-1.5">
                <Tooltip content={it.visible ? s.graph.hideExpression(i + 1) : s.graph.showExpression(i + 1)}>
                  <button
                    type="button"
                    aria-label={it.visible ? s.graph.hideExpression(i + 1) : s.graph.showExpression(i + 1)}
                    aria-pressed={it.visible}
                    onClick={() => setItem(it.id, { visible: !it.visible })}
                    className="flex size-7 shrink-0 items-center justify-center rounded-btn hover:bg-fill-hover"
                    style={{ color: `var(--plot-${it.color + 1})` }}
                  >
                    {it.visible ? <Eye size={15} /> : <EyeOff size={15} />}
                  </button>
                </Tooltip>
                <input
                  ref={(el) => {
                    if (el) inputs.current.set(it.id, el);
                    else inputs.current.delete(it.id);
                  }}
                  value={it.src}
                  onChange={(e) => setItem(it.id, { src: e.target.value })}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (i === items.length - 1) add();
                      else inputs.current.get(items[i + 1].id)?.focus();
                    }
                  }}
                  data-testid="graph-expr"
                  aria-label={s.graph.expression(i + 1)}
                  aria-invalid={!!err}
                  aria-describedby={err ? errId : undefined}
                  placeholder={i === 0 ? s.graph.placeholder : undefined}
                  spellCheck={false}
                  autoComplete="off"
                  autoCapitalize="off"
                  className="h-8 min-w-0 flex-1 rounded-control border border-control bg-surface px-2.5 font-mono text-input text-fg placeholder:text-faint transition-colors focus:border-fg focus:outline-none aria-[invalid=true]:border-danger"
                />
                <Tooltip content={s.graph.remove(i + 1)}>
                  <Button variant="ghost-muted" size="icon-sm" aria-label={s.graph.remove(i + 1)} onClick={() => remove(it.id)}>
                    <X size={14} />
                  </Button>
                </Tooltip>
              </div>
              {err && (
                <p id={errId} data-testid="graph-error" role="status" className="ml-8.5 mt-0.5 text-meta text-danger-text">
                  {err}
                </p>
              )}
            </li>
          );
        })}
        <li>
          <Button variant="ghost-muted" size="sm" onClick={add} disabled={items.length >= MAX_ITEMS} className="w-full justify-start">
            <Plus size={14} />
            {s.graph.add}
          </Button>
          <p className="px-2.5 pt-1 text-meta text-faint">{s.graph.hint}</p>
        </li>
      </ul>
    </div>
  );
}
