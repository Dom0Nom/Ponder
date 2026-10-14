import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "../../lib/utils";

/** Wraps a pin/save/flag icon: fill follows `on`, pops with particles when it turns on (not on first render). */
export function LikeIcon({ on, children, className }: { on: boolean; children: ReactNode; className?: string }) {
  const prev = useRef(on);
  const [pop, setPop] = useState(false);
  useEffect(() => {
    if (on && !prev.current) {
      setPop(true);
      const t = setTimeout(() => setPop(false), 600);
      prev.current = on;
      return () => clearTimeout(t);
    }
    prev.current = on;
  }, [on]);
  return (
    <span className={cn("t-like inline-flex", className)} data-on={on} data-pop={pop}>
      {children}
    </span>
  );
}
