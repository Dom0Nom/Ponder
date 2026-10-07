import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { cn } from "../../lib/utils";
import { hasWebGL2, markShaderEnabled } from "../../lib/motion";
import { useIsDark, useReducedMotion } from "../../app/useTheme";
import { useUi } from "../../stores/ui";
import { FxBoundary } from "../fx/FxBoundary";
import markDark from "../../assets/brand/ponder-mark-dark.png";
import markLight from "../../assets/brand/ponder-mark-light.png";
import { acquireGlSlot, releaseGlSlot } from "./glSlots";
import { MARK_FADE_MS, type MarkShaderState } from "./markPresets";

export type PonderMarkState = "static" | "idle" | "generating";

const PonderShader = lazy(() => import("./PonderShader"));
const ASPECT = 211 / 274;

function useShaderLayer(want: boolean) {
  const id = useRef(Symbol("ponder-mark")).current;
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (want) {
      if (!acquireGlSlot(id)) return;
      setMounted(true);
      let inner = 0;
      const outer = requestAnimationFrame(() => {
        inner = requestAnimationFrame(() => setVisible(true));
      });
      return () => {
        cancelAnimationFrame(outer);
        cancelAnimationFrame(inner);
      };
    }
    setVisible(false);
    const t = setTimeout(() => {
      setMounted(false);
      releaseGlSlot(id);
    }, MARK_FADE_MS);
    return () => clearTimeout(t);
  }, [want, id]);

  useEffect(() => () => releaseGlSlot(id), [id]);
  return { mounted, visible };
}

export function PonderMark({ size, state = "static", className }: { size: number; state?: PonderMarkState; className?: string }) {
  const dark = useIsDark();
  const effects = useUi((st) => st.visualEffects);
  const reduced = useReducedMotion();
  const want = state !== "static" && markShaderEnabled(effects, reduced, hasWebGL2());
  const { mounted, visible } = useShaderLayer(want);
  const last = useRef<MarkShaderState>("idle");
  if (state !== "static") last.current = state;
  const src = dark ? markDark : markLight;

  return (
    <span
      className={cn("relative inline-block shrink-0", className)}
      style={{ height: size, width: Math.round(size * ASPECT) }}
      data-shader={mounted ? (visible ? "on" : "in") : "off"}
    >
      <img src={src} alt="" aria-hidden draggable={false} data-state={state} className="block size-full select-none" />
      {mounted && (
        <FxBoundary fallback={null}>
          <Suspense fallback={null}>
            <PonderShader image={src} dark={dark} state={last.current} visible={visible && want} />
          </Suspense>
        </FxBoundary>
      )}
    </span>
  );
}
