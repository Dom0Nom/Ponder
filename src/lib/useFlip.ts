import { useLayoutEffect, useRef, type RefObject } from "react";
import { motionReduced } from "../app/useTheme";

/** Slides [data-flip-key] children from their previous offset to the new one. */
export function useFlip(list: RefObject<HTMLElement | null>, deps: unknown[]) {
  const prev = useRef(new Map<string, [number, number]>());
  useLayoutEffect(() => {
    const el = list.current;
    if (!el) return;
    const reduce = motionReduced();
    const next = new Map<string, [number, number]>();
    el.querySelectorAll<HTMLElement>("[data-flip-key]").forEach((c) => {
      const pos: [number, number] = [c.offsetLeft, c.offsetTop];
      next.set(c.dataset.flipKey!, pos);
      const before = prev.current.get(c.dataset.flipKey!);
      if (!reduce && before && (before[0] !== pos[0] || before[1] !== pos[1]))
        c.animate([{ transform: `translate(${before[0] - pos[0]}px, ${before[1] - pos[1]}px)` }, { transform: "none" }], {
          duration: 200,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        });
    });
    prev.current = next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
