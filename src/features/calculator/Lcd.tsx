import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Model } from "./engine/render";
import { paint, rasterize } from "./lcd/draw";
import { s } from "../../lib/strings";

const BOX = { x: 78, y: 71, w: 243, h: 104 };

/** Dot-matrix display, drawn on a canvas at the on-screen resolution. */
export function Lcd({ model, text, scale, reduced }: { model: Model; text: string; scale: number; reduced: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [blink, setBlink] = useState(true);

  useEffect(() => {
    if (reduced) {
      setBlink(true);
      return;
    }
    const id = window.setInterval(() => setBlink((b) => !b), 500);
    return () => window.clearInterval(id);
  }, [reduced]);

  useEffect(() => setBlink(true), [model]);

  useLayoutEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(BOX.w * scale * dpr);
    const h = Math.round(BOX.h * scale * dpr);
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const css = getComputedStyle(c);
    paint(ctx, rasterize(model, blink), model.ind, {
      width: w,
      height: h,
      ink: css.getPropertyValue("--calc-lcd-ink").trim() || "black",
      bg: css.getPropertyValue("--calc-lcd").trim() || "white",
      font: css.getPropertyValue("--font-ui").trim() || "sans-serif",
    });
  }, [model, blink, scale]);

  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={s.calc.display}
      aria-description={text}
      data-testid="calc-lcd"
      className="absolute"
      style={{ left: BOX.x, top: BOX.y, width: BOX.w, height: BOX.h, background: "var(--calc-lcd)" }}
    />
  );
}
