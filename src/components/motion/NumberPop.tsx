import { useRef } from "react";

/** `onMount` also pops the first render (for numbers that appear as a result). */
export function NumberPop({ text, popKey, className, onMount }: { text: string; popKey: string | number; className?: string; onMount?: boolean }) {
  const first = useRef(popKey);
  const animate = onMount || first.current !== popKey;
  const chars = [...text];
  return (
    <span className={className} style={{ position: "relative", display: "inline-block" }}>
      <span key={popKey} className={animate ? "t-digit-group is-animating" : "t-digit-group"}>
        {chars.map((ch, i) => (
          <span key={i} className="t-digit" data-stagger={i === chars.length - 2 ? "1" : i === chars.length - 1 ? "2" : undefined}>
            {ch}
          </span>
        ))}
      </span>
    </span>
  );
}
