import { useLayoutEffect, useRef } from "react";
import { motionReduced } from "../../app/useTheme";

/** Two-line live view of the model's reasoning that follows the newest line. */
export function ReasoningPeek({ text }: { text: string }) {
  const box = useRef<HTMLDivElement>(null);
  const scroll = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const b = box.current;
    const sc = scroll.current;
    if (!b || !sc) return;
    const lineH = parseFloat(getComputedStyle(sc).lineHeight) || 17.4;
    const offset = Math.ceil(Math.max(0, sc.offsetHeight - b.clientHeight) / lineH) * lineH;
    sc.style.transition = motionReduced() ? "none" : "transform var(--reason-step) var(--reason-ease)";
    sc.style.transform = `translateY(${-offset}px)`;
  }, [text]);
  return (
    <div ref={box} className="t-reason h-[35px] text-xs leading-[1.45] text-muted" aria-hidden>
      <div className="t-reason-viewport">
        <div ref={scroll} className="t-reason-scroll whitespace-pre-wrap">
          {text}
        </div>
      </div>
    </div>
  );
}
