import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { SquareArrowOutUpRight } from "lucide-react";
import { api } from "../../lib/ipc";
import { s } from "../../lib/strings";
import { cn } from "../../lib/utils";
import { Segmented, Tooltip } from "../../components/ui/misc";
import { toastError } from "../../components/ui/toast";
import { BODY, Calculator } from "./Calculator";
import { ClassicCalculator } from "./classic/ClassicCalculator";
import { GraphingCalculator } from "./graph/GraphingCalculator";

export type CalcMode = "scientific" | "graphing" | "classic";

const MODE_KEY = "ponder.calc.mode";
const MODES: CalcMode[] = ["scientific", "graphing", "classic"];

export function loadMode(): CalcMode {
  try {
    const v = localStorage.getItem(MODE_KEY);
    if (MODES.includes(v as CalcMode)) return v as CalcMode;
  } catch {
    /* storage unavailable */
  }
  return "scientific";
}

function saveMode(m: CalcMode) {
  try {
    localStorage.setItem(MODE_KEY, m);
  } catch {
    /* storage unavailable: the choice just won't carry over */
  }
}

function ModeSwitch({ mode, onChange }: { mode: CalcMode; onChange: (m: CalcMode) => void }) {
  return (
    <Segmented<CalcMode>
      size="sm"
      label={s.calcModes.label}
      value={mode}
      onChange={onChange}
      options={[
        { value: "scientific", label: s.calcModes.scientific },
        { value: "graphing", label: s.calcModes.graphing },
        { value: "classic", label: s.calcModes.classic },
      ]}
    />
  );
}

function PopOut() {
  const open = async () => {
    try {
      await api.openCalculatorWindow(s.calc.title);
    } catch (e) {
      toastError(s.calc.popOutFailed, e, open);
    }
  };
  return (
    <Tooltip content={s.calc.popOut}>
      <button
        type="button"
        aria-label={s.calc.popOut}
        onClick={open}
        className="flex h-7 w-7 items-center justify-center rounded-[6px] text-muted hover:bg-fill-hover hover:text-fg"
      >
        <SquareArrowOutUpRight size={14} />
      </button>
    </Tooltip>
  );
}

function useMode() {
  const [mode, setMode] = useState<CalcMode>(loadMode);
  const change = (m: CalcMode) => {
    setMode(m);
    saveMode(m);
  };
  return [mode, change] as const;
}

/** Studio panel: the mode switch sits in the empty band above the scientific device so that view stays as it was. */
export function CalculatorPanel({ popOut = false }: { popOut?: boolean }) {
  const [mode, setMode] = useMode();
  return (
    <div dir="ltr" className="relative h-full min-h-0" data-testid="calculator-panel" data-mode={mode}>
      <div className={cn("absolute left-2 top-1 z-10", popOut ? "right-10" : "right-2")}>
        <ModeSwitch mode={mode} onChange={setMode} />
      </div>
      {mode === "scientific" ? (
        <Calculator fit popOut={popOut} />
      ) : (
        <div className="flex h-full min-h-0 flex-col pt-10">
          {popOut && (
            <div className="absolute right-1 top-1 z-10">
              <PopOut />
            </div>
          )}
          {mode === "graphing" ? <GraphingCalculator /> : <ClassicCalculator />}
        </div>
      )}
    </div>
  );
}

/** Pop-out window: a top bar with the switch, the rest of the window for the calculator. */
export function CalculatorWindowBody() {
  const [mode, setMode] = useMode();
  const body = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const update = () => {
      const el = body.current;
      if (el) setScale(Math.max(0.3, Math.min(el.clientWidth / BODY.w, el.clientHeight / BODY.h)));
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [mode]);
  useEffect(() => {
    document.title = s.calc.title;
  }, []);
  return (
    <div dir="ltr" className="flex h-screen flex-col bg-surface" data-testid="calculator-panel" data-mode={mode}>
      <div className="flex h-10 shrink-0 items-center justify-center px-2">
        <ModeSwitch mode={mode} onChange={setMode} />
      </div>
      <div ref={body} className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        {mode === "scientific" && <Calculator globalKeys scale={scale} />}
        {mode !== "scientific" && <div className="h-full w-full">{mode === "graphing" ? <GraphingCalculator /> : <ClassicCalculator globalKeys />}</div>}
      </div>
    </div>
  );
}
