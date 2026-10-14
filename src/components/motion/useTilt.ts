import { useCallback, useRef, type PointerEvent } from "react";
import { useVisualEffects } from "../../app/useTheme";

const MAX = 6;

/** Pointer-only card tilt with a glare spot; off with Visual effects. Spread on the card (needs `relative`). */
export function useTilt() {
  const on = useVisualEffects();
  const raf = useRef(0);
  const move = useCallback((e: PointerEvent<HTMLElement>) => {
    if (e.pointerType !== "mouse") return;
    const el = e.currentTarget;
    const { clientX, clientY } = e;
    cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(() => {
      const r = el.getBoundingClientRect();
      const px = (clientX - r.left) / r.width;
      const py = (clientY - r.top) / r.height;
      el.dataset.tilting = "true";
      el.style.setProperty("--tilt-x", `${((0.5 - py) * 2 * MAX).toFixed(2)}deg`);
      el.style.setProperty("--tilt-y", `${((px - 0.5) * 2 * MAX).toFixed(2)}deg`);
      el.style.setProperty("--tilt-gx", `${(px * 100).toFixed(1)}%`);
      el.style.setProperty("--tilt-gy", `${(py * 100).toFixed(1)}%`);
    });
  }, []);
  const leave = useCallback((e: PointerEvent<HTMLElement>) => {
    cancelAnimationFrame(raf.current);
    const el = e.currentTarget;
    el.dataset.tilting = "false";
    el.style.setProperty("--tilt-x", "0deg");
    el.style.setProperty("--tilt-y", "0deg");
  }, []);
  return on ? { className: "t-tilt", onPointerMove: move, onPointerLeave: leave } : { className: "", onPointerMove: undefined, onPointerLeave: undefined };
}
