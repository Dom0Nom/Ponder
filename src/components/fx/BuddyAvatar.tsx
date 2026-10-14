import { BotAvatar } from "bot-avatars";
import { useIsDark } from "../../app/useTheme";
import { useFxActive } from "./useFxActive";
import { useMemo, useRef } from "react";

/** Study buddy avatar: the one place bot-avatars is used. Animates only while visible and focused. */
export default function BuddyAvatar({ size = 28, state = "default" }: { size?: number; state?: "default" | "working" | "sleeping" }) {
  const dark = useIsDark();
  const ref = useRef<HTMLSpanElement>(null);
  const active = useFxActive(ref);
  const color = useMemo(() => {
    const c = document.createElement("canvas").getContext("2d");
    if (!c) return "#808080";
    c.fillStyle = "#808080";
    c.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--muted").trim();
    return c.fillStyle;
  }, [dark]);
  return (
    <span ref={ref} className="inline-flex shrink-0" aria-hidden>
      <BotAvatar type="pebble" state={state} size={size} shading="smooth" color={color} theme={dark ? "dark" : "light"} paused={!active} />
    </span>
  );
}
