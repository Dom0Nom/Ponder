import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Model } from "./engine/render";
import { compose, paint, rasterize } from "./lcd/draw";
import { s } from "../../lib/strings";

/** White LCD area in the 400×560 frame; the dots fill its top 99.75 px (UI-SPEC §3.1). */
const BOX = { x: 78.55, y: 70.49, w: 242.78, h: 103.9, dotsH: 99.75 };
/** Integer-aligned canvas around it, so the browser never snaps the fractional edges. */
const CANVAS = { x: 78, y: 70, w: 245, h: 105 };

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
    const k = scale * dpr;
    const w = Math.round(CANVAS.w * k);
    const h = Math.round(CANVAS.h * k);
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const css = getComputedStyle(c);
    paint(ctx, compose(rasterize(model, blink), model.ind), {
      width: w,
      height: h,
      k,
      origin: CANVAS,
      lcd: BOX,
      ink: css.getPropertyValue("--calc-lcd-ink").trim() || "black",
      bg: css.getPropertyValue("--calc-lcd").trim() || "white",
    });
  }, [model, blink, scale]);

  return (
    <canvas
      ref={ref}
      role="img"
      aria-label={s.calc.display}
      aria-description={text}
      data-testid="calc-lcd"
      className="absolute block"
      style={{ left: CANVAS.x, top: CANVAS.y, width: CANVAS.w, height: CANVAS.h }}
    />
  );
}
