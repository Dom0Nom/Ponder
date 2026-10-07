import { useEffect, useRef, useState } from "react";
import { motionReduced } from "../../app/useTheme";
import { useStayMounted } from "./useStayMounted";

/** Drives a two-page slide: page 2 mounts for `value`, slides in next frame and stays mounted for its exit. */
export function usePageSlide<T>(value: T | null, exitMs = 250) {
  const present = value != null;
  const mounted = useStayMounted(present, exitMs);
  const last = useRef(value);
  if (present) last.current = value;
  const [shown, setShown] = useState(present);
  useEffect(() => {
    if (!present) {
      setShown(false);
      return;
    }
    if (motionReduced()) {
      setShown(true);
      return;
    }
    const id = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(id);
  }, [present]);
  const reduced = motionReduced();
  return {
    page: present && (shown || reduced) ? (2 as const) : (1 as const),
    sub: present || mounted ? last.current : null,
  };
}
