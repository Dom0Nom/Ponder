import { ThinkingOrb, type OrbState } from "thinking-orbs";
import { useIsDark, useReducedMotion } from "../../app/useTheme";

export type Activity = "search" | "think" | "write" | "cards" | "grade" | "plan" | "research" | "read" | "listen";

export const ORB_STATE: Record<Activity, OrbState> = {
  search: "searching",
  think: "breathing",
  write: "composing",
  cards: "shaping",
  grade: "solving",
  plan: "weaving",
  research: "connecting",
  read: "working",
  listen: "listening",
};

export function ActivityOrb({ activity, size = 16, inverse = false }: { activity: Activity; size?: 16 | 20 | 32; inverse?: boolean }) {
  const dark = useIsDark() !== inverse;
  const reduce = useReducedMotion();
  return (
    <ThinkingOrb
      state={ORB_STATE[activity]}
      size={size === 32 ? 32 : 20}
      theme={dark ? "dark" : "light"}
      paused={reduce}
      aria-hidden
      style={{ width: size, height: size, flex: "none" }}
    />
  );
}
