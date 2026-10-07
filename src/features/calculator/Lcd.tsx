import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { Model } from "./engine/render";
import { compose, paint, rasterize } from "./lcd/draw";
import { s } from "../../lib/strings";

/** White LCD area in the 400×560 frame; the dots fill its top 99.75 px (UI-SPEC §3.1). */
const BOX = { x: 78.55, y: 70.49, w: 242.78, h: 103.9, dotsH: 99.75 };

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
    const h = Math.round(BOX.dotsH * scale * dpr);
    if (c.width !== w) c.width = w;
    if (c.height !== h) c.height = h;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    const css = getComputedStyle(c);
    paint(ctx, compose(rasterize(model, blink), model.ind), {
      width: w,
      height: h,
      ink: css.getPropertyValue("--calc-lcd-ink").trim() || "black",
      bg: css.getPropertyValue("--calc-lcd").trim() || "white",
    });
  }, [model, blink, scale]);

  return (
    <div className="absolute" style={{ left: BOX.x, top: BOX.y, width: BOX.w, height: BOX.h, background: "var(--calc-lcd)" }}>
      <canvas
        ref={ref}
        role="img"
        aria-label={s.calc.display}
        aria-description={text}
        data-testid="calc-lcd"
        className="block"
        style={{ width: BOX.w, height: BOX.dotsH }}
      />
    </div>
  );
}
