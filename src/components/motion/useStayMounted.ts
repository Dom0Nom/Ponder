import { useEffect, useState } from "react";
import { motionReduced } from "../../app/useTheme";

/** true while open, and for `ms` after closing so the exit transition can play. */
export function useStayMounted(open: boolean, ms: number) {
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const t = setTimeout(() => setMounted(false), motionReduced() ? 0 : ms);
    return () => clearTimeout(t);
  }, [open, ms]);
  return mounted;
}
