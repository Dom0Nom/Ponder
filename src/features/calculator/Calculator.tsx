import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { SquareArrowOutUpRight } from "lucide-react";
import { api } from "../../lib/ipc";
import { s } from "../../lib/strings";
import { cn } from "../../lib/utils";
import { useReducedMotion } from "../../app/useTheme";
import { Tooltip } from "../../components/ui/misc";
import { toastError } from "../../components/ui/toast";
import { Calculator as Engine } from "./engine";
import { KEYBOARD } from "./keys";
import { Keypad, type KeyHandlers } from "./Keypad";
import { Lcd } from "./Lcd";

const STORAGE_KEY = "ponder.calc.v1";
export const CALC_W = 400;
export const CALC_H = 560;

function loadEngine(): Engine {
  try {
    return Engine.load(localStorage.getItem(STORAGE_KEY));
  } catch {
    return new Engine();
  }
}

function saveEngine(e: Engine) {
  try {
    localStorage.setItem(STORAGE_KEY, e.serialize());
  } catch {
    /* storage unavailable: the calculator still works, it just won't carry over */
  }
}

export interface CalcHook {
  press: (key: string) => void;
  text: () => { lines: string[]; indicators: string[] };
  reset: () => void;
}

declare global {
  interface Window {
    __calc?: CalcHook;
  }
}

export interface CalculatorProps {
  /** Fixed scale of the 400×560 device frame. Ignored with `fit`. */
  scale?: number;
  /** Scale to the container width (Studio view). */
  fit?: boolean;
  /** Show the "open in its own window" control. */
  popOut?: boolean;
  /** Listen to the keyboard on the whole window (pop-out window), not only when focused. */
  globalKeys?: boolean;
  className?: string;
}

/** Scientific calculator with the GED test layout. State persists and carries over to the pop-out window. */
export function Calculator({ scale: fixed = 1, fit = false, popOut = false, globalKeys = false, className }: CalculatorProps) {
  const engine = useRef<Engine | null>(null);
  if (!engine.current) engine.current = loadEngine();
  const [version, setVersion] = useState(0);
  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const reduced = useReducedMotion();
  const [pressed, setPressed] = useState<ReadonlySet<string>>(new Set());
  const [last, setLast] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [fitScale, setFitScale] = useState(1);
  const scale = fit ? fitScale : fixed;

  useLayoutEffect(() => {
    if (!fit || !wrap.current) return;
    const el = wrap.current;
    const update = () => setFitScale(Math.max(0.3, el.clientWidth / CALC_W));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fit]);

  const press = useCallback(
    (key: string) => {
      engine.current!.press(key);
      saveEngine(engine.current!);
      bump();
    },
    [bump],
  );

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY || !e.newValue) return;
      engine.current = Engine.load(e.newValue);
      bump();
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [bump]);

  useEffect(() => {
    if (!import.meta.env.DEV && !("__MOCK_BACKEND__" in window)) return;
    const hook: CalcHook = {
      press,
      text: () => engine.current!.text(),
      reset: () => {
        engine.current = new Engine();
        saveEngine(engine.current);
        bump();
      },
    };
    window.__calc = hook;
    return () => {
      if (window.__calc === hook) delete window.__calc;
    };
  }, [press, bump]);

  const keys: KeyHandlers = useMemo(
    () => ({
      pressed,
      last,
      onDown: (id) => {
        setPressed((p) => new Set(p).add(id));
        setLast(id);
        if (!globalKeys && document.activeElement !== wrap.current) wrap.current?.focus({ preventScroll: true });
        press(id);
      },
      onUp: (id) =>
        setPressed((p) => {
          if (!p.has(id)) return p;
          const n = new Set(p);
          n.delete(id);
          return n;
        }),
    }),
    [pressed, last, press, globalKeys],
  );

  const onKeyDown = useCallback(
    (e: KeyboardEvent | React.KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = KEYBOARD[e.key];
      if (!k) return;
      e.preventDefault();
      if (e.repeat) press(k);
      else keys.onDown(k);
    },
    [keys, press],
  );
  const onKeyUp = useCallback(
    (e: KeyboardEvent | React.KeyboardEvent) => {
      const k = KEYBOARD[e.key];
      if (k) keys.onUp(k);
    },
    [keys],
  );

  useEffect(() => {
    if (!globalKeys) return;
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [globalKeys, onKeyDown, onKeyUp]);

  const model = useMemo(() => engine.current!.model(), [version]); // eslint-disable-line react-hooks/exhaustive-deps
  const text = useMemo(() => engine.current!.text().lines.join("\n"), [version]); // eslint-disable-line react-hooks/exhaustive-deps

  const openWindow = async () => {
    saveEngine(engine.current!);
    try {
      await api.openCalculatorWindow(s.calc.title);
    } catch (e) {
      toastError(s.calc.popOutFailed, e, openWindow);
    }
  };

  return (
    <div
      ref={wrap}
      role="application"
      aria-label={s.calc.title}
      data-testid="calculator"
      tabIndex={globalKeys ? -1 : 0}
      onKeyDown={globalKeys ? undefined : onKeyDown}
      onKeyUp={globalKeys ? undefined : onKeyUp}
      className={cn("calc-root relative shrink-0 select-none overflow-hidden", className)}
      style={{ width: fit ? "100%" : CALC_W * scale, height: CALC_H * scale }}
    >
      <div className="absolute left-0 top-0 origin-top-left" style={{ width: CALC_W, height: CALC_H, transform: `scale(${scale})` }}>
        <div className="absolute" style={{ left: 66, top: 30, width: 267.9, height: 519.1, borderRadius: 8.5, background: "var(--calc-body)" }} />
        <Lcd model={model} text={text} scale={scale} reduced={reduced} />
        <Keypad h={keys} />
      </div>
      {popOut && (
        <Tooltip content={s.calc.popOut}>
          <button
            type="button"
            aria-label={s.calc.popOut}
            onClick={openWindow}
            className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-[6px] text-muted hover:bg-fill-hover hover:text-fg"
          >
            <SquareArrowOutUpRight size={14} />
          </button>
        </Tooltip>
      )}
    </div>
  );
}
