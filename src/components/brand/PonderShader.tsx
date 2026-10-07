import { useEffect, useRef } from "react";
import type { PaperShaderElement } from "@paper-design/shaders";
import { LiquidMetal } from "@paper-design/shaders-react";
import { MARK_FADE_MS, MARK_PRESETS, type MarkShaderState } from "./markPresets";

const NO_BACK = "rgba(0, 0, 0, 0)";
// The library redraws every display frame while animating; these marks move slowly, so we step frames ourselves.
const FPS: Record<MarkShaderState, number> = { idle: 12, generating: 30 };

function useSteppedFrames(state: MarkShaderState, speed: number) {
  const ref = useRef<PaperShaderElement>(null);
  useEffect(() => {
    const step = 1000 / FPS[state];
    let frame = 0;
    let id = 0;
    const tick = () => {
      frame += step * speed;
      ref.current?.paperShaderMount?.setFrame(frame);
    };
    const start = () => {
      if (!id && !document.hidden) id = window.setInterval(tick, step);
    };
    const stop = () => {
      window.clearInterval(id);
      id = 0;
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [state, speed]);
  return ref;
}

export default function PonderShader({
  image,
  dark,
  state,
  visible,
}: {
  image: string;
  dark: boolean;
  state: MarkShaderState;
  visible: boolean;
}) {
  const { opacity, speed, ...p } = MARK_PRESETS[state];
  const ref = useSteppedFrames(state, speed);
  const tint = getComputedStyle(document.documentElement).getPropertyValue(dark ? "--mark-tint-dark" : "--mark-tint-light").trim();
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{ opacity: visible ? opacity : 0, transition: `opacity ${MARK_FADE_MS}ms ease-in-out` }}
    >
      <LiquidMetal {...p} ref={ref} speed={0} minPixelRatio={1} image={image} colorBack={NO_BACK} colorTint={tint} fit="contain" scale={1} width="100%" height="100%" />
    </div>
  );
}
