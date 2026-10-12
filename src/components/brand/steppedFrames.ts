import { useEffect, useRef } from "react";
import type { PaperShaderElement } from "@paper-design/shaders";
import type { MarkShaderState } from "./markPresets";

// The library redraws every display frame while animating; these marks move slowly, so we step frames ourselves.
const FPS: Record<MarkShaderState, number> = { idle: 12, generating: 30 };
// An idle mark nobody is looking at still costs a composited WebGL layer per frame, so it rests after this long
// without input, and whenever the window is hidden or unfocused.
export const IDLE_REST_MS = 30_000;

export function useSteppedFrames(state: MarkShaderState, speed: number) {
  const ref = useRef<PaperShaderElement>(null);
  useEffect(() => {
    const step = 1000 / FPS[state];
    let frame = 0;
    let id = 0;
    let rest = 0;
    const tick = () => {
      frame += step * speed;
      ref.current?.paperShaderMount?.setFrame(frame);
    };
    const stop = () => {
      window.clearInterval(id);
      id = 0;
    };
    const start = () => {
      if (!id && !document.hidden && document.hasFocus()) id = window.setInterval(tick, step);
      if (state === "idle") {
        window.clearTimeout(rest);
        rest = window.setTimeout(stop, IDLE_REST_MS);
      }
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    const wake = ["pointermove", "pointerdown", "keydown", "wheel", "focus"] as const;
    start();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("blur", stop);
    for (const ev of wake) window.addEventListener(ev, start, { passive: true });
    return () => {
      stop();
      window.clearTimeout(rest);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("blur", stop);
      for (const ev of wake) window.removeEventListener(ev, start);
    };
  }, [state, speed]);
  return ref;
}
