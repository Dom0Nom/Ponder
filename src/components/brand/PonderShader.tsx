import { LiquidMetal } from "@paper-design/shaders-react";
import { MARK_FADE_MS, MARK_PRESETS, type MarkShaderState } from "./markPresets";

const NO_BACK = "rgba(0, 0, 0, 0)";

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
  const { opacity, ...p } = MARK_PRESETS[state];
  const tint = getComputedStyle(document.documentElement).getPropertyValue(dark ? "--mark-tint-dark" : "--mark-tint-light").trim();
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0"
      style={{ opacity: visible ? opacity : 0, transition: `opacity ${MARK_FADE_MS}ms ease-in-out` }}
    >
      <LiquidMetal {...p} image={image} colorBack={NO_BACK} colorTint={tint} fit="contain" scale={1} width="100%" height="100%" />
    </div>
  );
}
