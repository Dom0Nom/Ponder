import { useEffect, useLayoutEffect, useRef } from "react";
import { motionReduced } from "../../app/useTheme";

const ms = (name: string, fallback: number) => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name)) || fallback;

const makeText = (label: string, shimmer: boolean) => {
  const el = document.createElement("span");
  el.className = shimmer ? "t-think-text" : "t-think-text is-static";
  el.dataset.text = label;
  el.textContent = label;
  return el;
};

/** Status label with shimmer; a changed label swaps like Transitions.dev Thinking states. */
export function ThinkingLine({ label, shimmer = true, className }: { label: string; shimmer?: boolean; className?: string }) {
  const box = useRef<HTMLSpanElement>(null);
  const current = useRef<HTMLSpanElement | null>(null);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const t = timers.current;
    return () => t.forEach(clearTimeout);
  }, []);

  useLayoutEffect(() => {
    const host = box.current;
    if (!host) return;
    const prev = current.current;
    if (!prev || motionReduced()) {
      host.querySelectorAll(".t-think-text").forEach((n) => n.remove());
      current.current = host.appendChild(makeText(label, shimmer));
      return;
    }
    if (prev.dataset.text === label && prev.classList.contains("is-static") === !shimmer) return;
    const next = makeText(label, shimmer);
    next.classList.add("is-enter-start");
    host.appendChild(next);
    current.current = next;
    prev.classList.add("is-exit");
    const gap = ms("--think-gap", 50);
    const swap = ms("--think-swap", 150);
    timers.current.push(
      setTimeout(() => {
        void next.offsetHeight;
        next.classList.remove("is-enter-start");
      }, gap),
      setTimeout(() => prev.remove(), swap + gap),
    );
  }, [label, shimmer]);

  return (
    <span ref={box} className={className ? `t-think ${className}` : "t-think"} role="status" aria-live="polite">
      <span className="t-think-sizer">{label}</span>
    </span>
  );
}
