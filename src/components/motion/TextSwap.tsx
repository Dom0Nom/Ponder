import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { motionReduced } from "../../app/useTheme";

export function TextSwap({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [shown, setShown] = useState(text);
  useEffect(() => {
    const el = ref.current;
    if (!el || text === shown) return;
    if (motionReduced()) {
      setShown(text);
      return;
    }
    const dur = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--motion-quick")) || 150;
    el.classList.add("is-exit");
    const t = setTimeout(() => {
      flushSync(() => setShown(text));
      el.classList.remove("is-exit");
      el.classList.add("is-enter-start");
      void el.offsetHeight;
      el.classList.remove("is-enter-start");
    }, dur);
    return () => clearTimeout(t);
  }, [text, shown]);
  return (
    <span ref={ref} className={className ? `t-text-swap ${className}` : "t-text-swap"}>
      {shown}
    </span>
  );
}
