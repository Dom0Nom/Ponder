import type { ReactNode } from "react";
import { BorderBeam } from "border-beam";
import { useIsDark } from "../../app/useTheme";

type Kind = "md" | "line" | "sm" | "pulse-inner";

const KNOBS: Record<Kind, { duration: number; strength: number }> = {
  md: { duration: 2.4, strength: 0.8 },
  line: { duration: 2.4, strength: 0.9 },
  sm: { duration: 2.4, strength: 0.8 },
  "pulse-inner": { duration: 2.8, strength: 0.7 },
};

/** Beam on the container that holds the work: md for AI work over 3 s, line for the composer, sm for buttons, pulse-inner for "waiting for you". */
export default function WorkBeam({ active, size = "md", radius = 10, children }: { active: boolean; size?: Kind; radius?: number; children: ReactNode }) {
  const dark = useIsDark();
  const k = KNOBS[size];
  return (
    <BorderBeam size={size} colorVariant="mono" theme={dark ? "dark" : "light"} active={active} duration={k.duration} strength={k.strength} borderRadius={radius}>
      {children}
    </BorderBeam>
  );
}
