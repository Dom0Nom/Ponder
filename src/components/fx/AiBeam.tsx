import { lazy, useEffect, useState, type ReactNode } from "react";
import { Fx } from "./Fx";

const WorkBeam = lazy(() => import("./WorkBeam"));

/** Wraps the card that holds AI work. The beam starts once the work has run for `after` ms and stops with it. Plain children with Visual effects off. */
export function AiBeam({ working, after = 3000, radius = 10, size = "md", children }: { working: boolean; after?: number; radius?: number; size?: "md" | "sm"; children: ReactNode }) {
  const [on, setOn] = useState(after === 0 && working);
  useEffect(() => {
    if (!working) {
      setOn(false);
      return;
    }
    const t = setTimeout(() => setOn(true), after);
    return () => clearTimeout(t);
  }, [working, after]);
  return (
    <Fx
      fallback={children}
      render={() => (
        <WorkBeam active={on} size={size} radius={radius}>
          {children}
        </WorkBeam>
      )}
    />
  );
}
