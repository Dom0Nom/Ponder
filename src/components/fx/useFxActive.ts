import { useEffect, useState, type RefObject } from "react";
import { useReducedMotion, useVisualEffects } from "../../app/useTheme";

/** True only when Visual effects are on, motion is not reduced, the page is visible, the window is focused and the element is on screen. */
export function useFxActive(ref: RefObject<Element | null>): boolean {
  const effects = useVisualEffects();
  const reduced = useReducedMotion();
  const [visible, setVisible] = useState(() => document.visibilityState === "visible");
  const [focused, setFocused] = useState(() => document.hasFocus());
  const [inView, setInView] = useState(true);
  useEffect(() => {
    const vis = () => setVisible(document.visibilityState === "visible");
    const on = () => setFocused(true);
    const off = () => setFocused(false);
    document.addEventListener("visibilitychange", vis);
    window.addEventListener("focus", on);
    window.addEventListener("blur", off);
    return () => {
      document.removeEventListener("visibilitychange", vis);
      window.removeEventListener("focus", on);
      window.removeEventListener("blur", off);
    };
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => setInView(entries.some((e) => e.isIntersecting)), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, [ref]);
  return effects && !reduced && visible && focused && inView;
}
