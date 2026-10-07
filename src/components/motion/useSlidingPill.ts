import { useLayoutEffect, useRef, type RefObject } from "react";
import { motionReduced } from "../../app/useTheme";

export function useSlidingPill(list: RefObject<HTMLElement | null>, pill: RefObject<HTMLElement | null>, value: string) {
  const placed = useRef(false);
  useLayoutEffect(() => {
    const l = list.current;
    const p = pill.current;
    if (!l || !p) return;
    const place = (animate: boolean) => {
      const tab = l.querySelector<HTMLElement>('[aria-checked="true"]');
      if (!tab) return;
      if (!animate) p.style.transition = "none";
      p.style.transform = `translateX(${tab.offsetLeft}px)`;
      p.style.width = `${tab.offsetWidth}px`;
      p.style.top = `${tab.offsetTop}px`;
      p.style.height = `${tab.offsetHeight}px`;
      if (!animate) {
        void p.offsetWidth;
        p.style.transition = "";
      }
    };
    place(placed.current && !motionReduced());
    placed.current = true;
    if (typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => place(false));
    ro.observe(l);
    return () => ro.disconnect();
  }, [list, pill, value]);
}
